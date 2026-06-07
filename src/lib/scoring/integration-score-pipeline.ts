import { prisma } from "@/lib/prisma";
import { Prisma, type ScoreCategory } from "@prisma/client";
import { logger } from "@/lib/logger";
import {
  rawIndexToScore,
  computeDailyTasksIndex,
  computeProjectsIndex,
  getActiveScoringConfig,
} from "@/lib/scoring";
import { collectDailyTasksMetrics } from "./jira-metrics-collector";
import { collectProjectsMetrics } from "./confluence-metrics-collector";
import { env } from "@/lib/env";

/**
 * Compute integration-based scores for all active employees.
 * Runs as a background job to keep scores up-to-date from Jira/Confluence data.
 */
export async function computeIntegrationScores(): Promise<{
  employeesProcessed: number;
  scoresComputed: number;
  errors: number;
}> {
  const config = await getActiveScoringConfig();

  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = now;

  const periodLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  let period = await prisma.timePeriod.findFirst({
    where: { type: "month", label: periodLabel },
  });

  if (!period) {
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    period = await prisma.timePeriod.create({
      data: {
        type: "month",
        startDate: periodStart,
        endDate: monthEnd,
        label: periodLabel,
      },
    });
  }

  const employees = await prisma.employee.findMany({
    where: { active: true },
    select: { id: true, role: true },
  });

  let scoresComputed = 0;
  let errors = 0;

  for (const employee of employees) {
    const roleTargets = config.targets[employee.role];
    if (!roleTargets) continue;

    try {
      const jiraMetrics = await collectDailyTasksMetrics(
        employee.id, periodStart, periodEnd, config,
      );

      const dailyTasksRawIndex = computeDailyTasksIndex({
        ticketsResolved: jiraMetrics.ticketsResolved,
        ticketsTarget: roleTargets.daily_tasks.ticketsPerWeek,
        onTimeRate: jiraMetrics.onTimeRate,
        targetOnTimeRate: roleTargets.daily_tasks.onTimeRate,
        avgCycleTimeDays: jiraMetrics.avgCycleTimeDays,
        targetCycleTimeDays: roleTargets.daily_tasks.cycleTimeDays,
        reopenedRate: jiraMetrics.reopenedRate,
        workingDaysFactor: jiraMetrics.workingDaysFactor,
      });

      const dailyTasksScore = rawIndexToScore(dailyTasksRawIndex);

      await prisma.categoryScore.upsert({
        where: {
          employeeId_periodId_category: {
            employeeId: employee.id,
            periodId: period.id,
            category: "daily_tasks",
          },
        },
        create: {
          employeeId: employee.id,
          periodId: period.id,
          category: "daily_tasks",
          rawIndex: dailyTasksRawIndex,
          score: dailyTasksScore,
          configVersion: config.version,
          metadata: jiraMetrics as unknown as Prisma.InputJsonValue,
        },
        update: {
          rawIndex: dailyTasksRawIndex,
          score: dailyTasksScore,
          configVersion: config.version,
          metadata: jiraMetrics as unknown as Prisma.InputJsonValue,
        },
      });
      scoresComputed++;

      await createScoreEvidence(employee.id, period.id, "daily_tasks", periodStart, periodEnd);
    } catch (err) {
      logger.error("Failed to compute daily_tasks score", {
        employeeId: employee.id,
        error: err instanceof Error ? err.message : String(err),
      });
      errors++;
    }

    try {
      const confluenceMetrics = await collectProjectsMetrics(
        employee.id, periodStart, periodEnd, config,
      );

      const projectsRawIndex = computeProjectsIndex({
        pagesCreated: confluenceMetrics.pagesCreated,
        pagesCreatedTarget: roleTargets.projects.pagesCreatedPerMonth,
        pagesUpdated: confluenceMetrics.pagesUpdated,
        pagesUpdatedTarget: roleTargets.projects.pagesUpdatedPerMonth,
        qualityMarkers: confluenceMetrics.qualityMarkers,
        workingDaysFactor: confluenceMetrics.workingDaysFactor,
      });

      const projectsScore = rawIndexToScore(projectsRawIndex);

      await prisma.categoryScore.upsert({
        where: {
          employeeId_periodId_category: {
            employeeId: employee.id,
            periodId: period.id,
            category: "projects",
          },
        },
        create: {
          employeeId: employee.id,
          periodId: period.id,
          category: "projects",
          rawIndex: projectsRawIndex,
          score: projectsScore,
          configVersion: config.version,
          metadata: confluenceMetrics as unknown as Prisma.InputJsonValue,
        },
        update: {
          rawIndex: projectsRawIndex,
          score: projectsScore,
          configVersion: config.version,
          metadata: confluenceMetrics as unknown as Prisma.InputJsonValue,
        },
      });
      scoresComputed++;

      await createScoreEvidence(employee.id, period.id, "projects", periodStart, periodEnd);
    } catch (err) {
      logger.error("Failed to compute projects score", {
        employeeId: employee.id,
        error: err instanceof Error ? err.message : String(err),
      });
      errors++;
    }
  }

  logger.info("Integration score pipeline completed", {
    employeesProcessed: employees.length,
    scoresComputed,
    errors,
    periodLabel,
  });

  return {
    employeesProcessed: employees.length,
    scoresComputed,
    errors,
  };
}

async function createScoreEvidence(
  employeeId: string,
  periodId: string,
  category: ScoreCategory,
  periodStart: Date,
  periodEnd: Date,
): Promise<void> {
  const score = await prisma.categoryScore.findUnique({
    where: { employeeId_periodId_category: { employeeId, periodId, category } },
    select: { id: true },
  });
  if (!score) return;

  if (category === "daily_tasks") {
    const jiraBaseUrl = env("JIRA_BASE_URL")?.replace(/\/$/, "") ?? "";
    const resolvedIssues = await prisma.jiraIssueState.findMany({
      where: {
        employeeId,
        resolvedAt: { gte: periodStart, lte: periodEnd },
      },
      select: { issueKey: true, summary: true },
      take: 50,
    });

    for (const issue of resolvedIssues) {
      await prisma.scoreEvidence.upsert({
        where: {
          id: `${score.id}-${issue.issueKey}`,
        },
        create: {
          id: `${score.id}-${issue.issueKey}`,
          scoreId: score.id,
          evidenceType: "jira_ticket",
          sourceRef: issue.issueKey,
          label: `${issue.issueKey}: ${issue.summary}`.substring(0, 120),
          url: jiraBaseUrl ? `${jiraBaseUrl}/browse/${issue.issueKey}` : "",
          verified: true,
        },
        update: {
          label: `${issue.issueKey}: ${issue.summary}`.substring(0, 120),
          verified: true,
        },
      });
    }
  }

  if (category === "projects") {
    const confluenceBaseUrl = env("CONFLUENCE_BASE_URL")?.replace(/\/$/, "") ?? "";
    const pages = await prisma.confluencePageState.findMany({
      where: {
        employeeId,
        OR: [
          { createdInConfluence: { gte: periodStart, lte: periodEnd } },
          { updatedInConfluence: { gte: periodStart, lte: periodEnd } },
        ],
      },
      select: { pageId: true, title: true, spaceKey: true },
      take: 50,
    });

    for (const page of pages) {
      await prisma.scoreEvidence.upsert({
        where: {
          id: `${score.id}-${page.pageId}`,
        },
        create: {
          id: `${score.id}-${page.pageId}`,
          scoreId: score.id,
          evidenceType: "confluence_page",
          sourceRef: page.pageId,
          label: `[${page.spaceKey}] ${page.title}`.substring(0, 120),
          url: confluenceBaseUrl ? `${confluenceBaseUrl}/wiki/pages/${page.pageId}` : "",
          verified: true,
        },
        update: {
          label: `[${page.spaceKey}] ${page.title}`.substring(0, 120),
          verified: true,
        },
      });
    }
  }
}
