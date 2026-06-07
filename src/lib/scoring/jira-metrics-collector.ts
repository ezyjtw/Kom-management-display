import { prisma } from "@/lib/prisma";
import type { ScoringConfigData } from "@/types";

export interface DailyTasksMetrics {
  ticketsResolved: number;
  onTimeRate: number;
  avgCycleTimeDays: number;
  reopenedRate: number;
  workingDaysFactor: number;
}

export async function collectDailyTasksMetrics(
  employeeId: string,
  periodStart: Date,
  periodEnd: Date,
  config: ScoringConfigData,
): Promise<DailyTasksMetrics> {
  const doneStatuses = config.definitions.jira.doneStatuses.map((s: string) => s.toLowerCase());

  const resolvedIssues = await prisma.jiraIssueState.findMany({
    where: {
      employeeId,
      resolvedAt: { gte: periodStart, lte: periodEnd },
      jiraStatus: { in: config.definitions.jira.doneStatuses },
    },
    select: { jiraCreatedAt: true, resolvedAt: true },
  });

  const ticketsResolved = resolvedIssues.length;

  let totalCycleTimeDays = 0;
  let cycleTimeCount = 0;
  for (const issue of resolvedIssues) {
    if (issue.resolvedAt && issue.jiraCreatedAt) {
      const diffMs = issue.resolvedAt.getTime() - issue.jiraCreatedAt.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      totalCycleTimeDays += diffDays;
      cycleTimeCount++;
    }
  }
  const avgCycleTimeDays = cycleTimeCount > 0 ? totalCycleTimeDays / cycleTimeCount : 3;

  const totalAssigned = await prisma.jiraIssueState.count({
    where: {
      employeeId,
      jiraCreatedAt: { gte: periodStart, lte: periodEnd },
    },
  });

  const roleTargets = config.definitions.jira;
  const targetCycleDays = 3;
  const onTimeCount = resolvedIssues.filter((i) => {
    if (!i.resolvedAt || !i.jiraCreatedAt) return false;
    const diffDays = (i.resolvedAt.getTime() - i.jiraCreatedAt.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays <= targetCycleDays;
  }).length;
  const onTimeRate = ticketsResolved > 0 ? onTimeCount / ticketsResolved : 0;

  const reopenedCount = await prisma.jiraIssueState.count({
    where: {
      employeeId,
      status: { notIn: ["resolved", "deleted"] },
      resolvedAt: { not: null },
      jiraUpdatedAt: { gte: periodStart, lte: periodEnd },
    },
  });
  const reopenedRate = totalAssigned > 0 ? reopenedCount / totalAssigned : 0;

  const periodDays = Math.max(1, (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24));
  const ptoCount = await prisma.ptoRecord.count({
    where: {
      employeeId,
      startDate: { lte: periodEnd },
      endDate: { gte: periodStart },
      status: "approved",
    },
  });
  const workingDaysFactor = Math.max(0.1, 1 - (ptoCount * 5) / periodDays);

  return {
    ticketsResolved,
    onTimeRate,
    avgCycleTimeDays,
    reopenedRate,
    workingDaysFactor,
  };
}
