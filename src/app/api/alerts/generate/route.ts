import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeSlaStatus, isExcessiveBouncing, computeTravelRuleAging } from "@/lib/sla";
import { requireRole } from "@/lib/auth-user";

/**
 * GET /api/alerts/generate
 * For cron services (Vercel Cron, external cron). Protected by CRON_SECRET.
 *
 * POST /api/alerts/generate
 * Manual trigger from admin panel. Admin only.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ success: false, error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  return generateAlerts();
}

export async function POST() {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;
  return generateAlerts();
}

/**
 * Core alert generation logic shared by both GET (cron) and POST (manual).
 *
 * Scans three areas for alertable conditions:
 *   1. Comms threads — TTO, TTFA, TSLA breach and ownership bouncing
 *   2. Travel rule cases — SLA breach (>48h open)
 *   3. Employee performance — quality score drops and throughput drops
 *
 * Each check is idempotent: only creates an alert if no active alert of
 * the same type already exists for that entity.
 */
async function generateAlerts() {
  try {
    const now = new Date();
    let alertsCreated = 0;

    // --- Comms Thread SLA Checks ---
    // Batch-fetch all active alerts for threads to avoid N+1 queries
    const threads = await prisma.commsThread.findMany({
      where: {
        status: { notIn: ["Done", "Closed"] },
      },
      include: {
        ownershipChanges: {
          where: {
            changedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
          },
        },
      },
    });

    const threadIds = threads.map((t) => t.id);
    const existingThreadAlerts = await prisma.alert.findMany({
      where: {
        threadId: { in: threadIds },
        status: "active",
        type: { in: ["tto_breach", "ttfa_breach", "tsla_breach", "ownership_bounce"] },
      },
      select: { threadId: true, type: true },
    });
    const threadAlertSet = new Set(existingThreadAlerts.map((a) => `${a.threadId}:${a.type}`));

    const threadAlertBatch: Array<{
      threadId: string;
      type: string;
      priority: string;
      message: string;
      destination: string;
    }> = [];

    for (const thread of threads) {
      const sla = computeSlaStatus({
        createdAt: thread.createdAt,
        ownerUserId: thread.ownerUserId,
        lastActionAt: thread.lastActionAt,
        status: thread.status,
        priority: thread.priority,
        ttoDeadline: thread.ttoDeadline,
        ttfaDeadline: thread.ttfaDeadline,
        tslaDeadline: thread.tslaDeadline,
      });

      if (sla.isTtoBreached && !threadAlertSet.has(`${thread.id}:tto_breach`)) {
        threadAlertBatch.push({
          threadId: thread.id,
          type: "tto_breach",
          priority: thread.priority,
          message: `Thread "${thread.subject}" has been unassigned past SLA (${thread.priority})`,
          destination: "in_app",
        });
      }

      if (sla.isTtfaBreached && !threadAlertSet.has(`${thread.id}:ttfa_breach`)) {
        threadAlertBatch.push({
          threadId: thread.id,
          type: "ttfa_breach",
          priority: thread.priority,
          message: `Thread "${thread.subject}" assigned but no action taken past SLA`,
          destination: "in_app",
        });
      }

      if (sla.isTslaBreached && !threadAlertSet.has(`${thread.id}:tsla_breach`)) {
        threadAlertBatch.push({
          threadId: thread.id,
          type: "tsla_breach",
          priority: thread.priority,
          message: `Thread "${thread.subject}" has no activity past SLA threshold (status: ${thread.status})`,
          destination: "in_app",
        });
      }

      if (isExcessiveBouncing(thread.ownershipChanges) && !threadAlertSet.has(`${thread.id}:ownership_bounce`)) {
        threadAlertBatch.push({
          threadId: thread.id,
          type: "ownership_bounce",
          priority: "P1",
          message: `Thread "${thread.subject}" has excessive ownership changes (>2 in 24h)`,
          destination: "in_app",
        });
      }
    }

    if (threadAlertBatch.length > 0) {
      await prisma.alert.createMany({ data: threadAlertBatch });
      alertsCreated += threadAlertBatch.length;
    }

    // --- Travel Rule SLA Checks ---
    const openCases = await prisma.travelRuleCase.findMany({
      where: { status: { not: "Resolved" } },
    });

    const caseIds = openCases.filter((tc) => computeTravelRuleAging(tc.createdAt).agingStatus === "red").map((tc) => tc.id);
    const existingCaseAlerts = caseIds.length > 0
      ? await prisma.alert.findMany({
          where: { travelRuleCaseId: { in: caseIds }, type: "travel_rule_sla_breach", status: "active" },
          select: { travelRuleCaseId: true },
        })
      : [];
    const caseAlertSet = new Set(existingCaseAlerts.map((a) => a.travelRuleCaseId));

    const caseAlertBatch = openCases
      .filter((tc) => computeTravelRuleAging(tc.createdAt).agingStatus === "red" && !caseAlertSet.has(tc.id))
      .map((tc) => ({
        travelRuleCaseId: tc.id,
        type: "travel_rule_sla_breach",
        priority: "P1",
        message: `Travel rule case for ${tc.asset} ${tc.direction} (${tc.transactionId}) is over 48h old`,
        destination: "in_app",
      }));

    if (caseAlertBatch.length > 0) {
      await prisma.alert.createMany({ data: caseAlertBatch });
      alertsCreated += caseAlertBatch.length;
    }

    // --- Performance trend alerts ---
    // Batch-fetch all scores to avoid N+1 per employee
    const latestPeriod = await prisma.timePeriod.findFirst({
      where: { type: "month" },
      orderBy: { startDate: "desc" },
    });

    if (latestPeriod) {
      const previousPeriod = await prisma.timePeriod.findFirst({
        where: {
          type: "month",
          startDate: { lt: latestPeriod.startDate },
        },
        orderBy: { startDate: "desc" },
      });

      if (previousPeriod) {
        const employees = await prisma.employee.findMany({ where: { active: true } });
        const empIds = employees.map((e) => e.id);

        // Batch-fetch all category scores for both periods
        const allScores = await prisma.categoryScore.findMany({
          where: {
            employeeId: { in: empIds },
            periodId: { in: [latestPeriod.id, previousPeriod.id] },
            category: { in: ["quality", "daily_tasks"] },
          },
        });

        const scoreMap = new Map<string, number>();
        for (const s of allScores) {
          scoreMap.set(`${s.employeeId}:${s.periodId}:${s.category}`, s.score);
        }

        // Batch-fetch existing active perf alerts
        const existingPerfAlerts = await prisma.alert.findMany({
          where: {
            employeeId: { in: empIds },
            type: { in: ["mistakes_rising", "throughput_drop"] },
            status: "active",
          },
          select: { employeeId: true, type: true },
        });
        const perfAlertSet = new Set(existingPerfAlerts.map((a) => `${a.employeeId}:${a.type}`));

        const perfAlertBatch: Array<{
          employeeId: string;
          type: string;
          priority: string;
          message: string;
          destination: string;
        }> = [];

        for (const emp of employees) {
          const curQuality = scoreMap.get(`${emp.id}:${latestPeriod.id}:quality`);
          const prevQuality = scoreMap.get(`${emp.id}:${previousPeriod.id}:quality`);

          if (curQuality !== undefined && prevQuality !== undefined && curQuality < prevQuality - 0.5) {
            if (!perfAlertSet.has(`${emp.id}:mistakes_rising`)) {
              perfAlertBatch.push({
                employeeId: emp.id,
                type: "mistakes_rising",
                priority: "P2",
                message: `${emp.name} — quality score dropped from ${prevQuality.toFixed(1)} to ${curQuality.toFixed(1)}`,
                destination: "in_app",
              });
            }
          }

          const curTasks = scoreMap.get(`${emp.id}:${latestPeriod.id}:daily_tasks`);
          const prevTasks = scoreMap.get(`${emp.id}:${previousPeriod.id}:daily_tasks`);

          if (curTasks !== undefined && prevTasks !== undefined && curTasks < prevTasks - 0.5) {
            if (!perfAlertSet.has(`${emp.id}:throughput_drop`)) {
              perfAlertBatch.push({
                employeeId: emp.id,
                type: "throughput_drop",
                priority: "P2",
                message: `${emp.name} — task throughput dropped from ${prevTasks.toFixed(1)} to ${curTasks.toFixed(1)}`,
                destination: "in_app",
              });
            }
          }
        }

        if (perfAlertBatch.length > 0) {
          await prisma.alert.createMany({ data: perfAlertBatch });
          alertsCreated += perfAlertBatch.length;
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        threadsScanned: threads.length,
        travelRuleCasesScanned: openCases.length,
        alertsCreated,
        timestamp: now.toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "An internal error occurred" },
      { status: 500 }
    );
  }
}
