import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";
import { computeSlaStatus, computeTravelRuleAging } from "@/lib/sla";

/**
 * GET /api/command-center
 *
 * Aggregated data across all modules for the ops command center landing page.
 * Runs 7 independent queries in parallel via safeQuery — if any single query
 * fails (e.g. a table doesn't exist yet), the rest still return data so the
 * dashboard degrades gracefully rather than showing a blank page.
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  // Wraps each query so one failure doesn't break the whole page
  async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try { return await fn(); } catch { return fallback; }
  }

  try {
    const [openCases, activeThreads, activeAlerts, recentAudit, todaysTasks, activityCoverage, activeProjects, activeIncidents, stakingHeartbeat, dailyCheckStatus, screeningHealth, rcaStatus] = await Promise.all([
      safeQuery(() => prisma.travelRuleCase.findMany({
        where: { status: { not: "Resolved" } },
        orderBy: { createdAt: "asc" },
        take: 10,
      }), []),

      safeQuery(() => prisma.commsThread.findMany({
        where: { status: { notIn: ["Done", "Closed"] } },
        include: { owner: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      }), []),

      safeQuery(() => prisma.alert.findMany({
        where: { status: "active" },
        include: {
          thread: { select: { id: true, subject: true } },
          employee: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }), []),

      safeQuery(() => prisma.auditLog.findMany({
        where: {
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 15,
      }), []),

      // Today's daily tasks
      safeQuery(() => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const end = new Date(start.getTime() + 86400000);
        return prisma.dailyTask.findMany({
          where: { date: { gte: start, lt: end } },
          select: { id: true, status: true, team: true, priority: true },
        });
      }, []),

      // Team coverage: count how many Transaction Ops staff are currently active,
      // on queue monitoring duty, or on break. "Active" excludes lunch/break.
      safeQuery(async () => {
        const txOpsEmployees = await prisma.employee.findMany({
          where: { team: "Transaction Operations", active: true },
          select: {
            id: true,
            name: true,
            activityStatuses: { where: { endedAt: null }, orderBy: { startedAt: "desc" }, take: 1 },
          },
        });
        const total = txOpsEmployees.length;
        const active = txOpsEmployees.filter((e) => e.activityStatuses.length > 0 && !["lunch", "break"].includes(e.activityStatuses[0].activity)).length;
        const onQueues = txOpsEmployees.filter((e) => e.activityStatuses.length > 0 && e.activityStatuses[0].activity === "queue_monitoring").length;
        const onBreak = txOpsEmployees.filter((e) => e.activityStatuses.length > 0 && ["lunch", "break"].includes(e.activityStatuses[0].activity)).length;
        return { total, active, onQueues, onBreak };
      }, { total: 0, active: 0, onQueues: 0, onBreak: 0 }),

      safeQuery(() => prisma.project.findMany({
        where: { status: { in: ["active", "on_hold"] } },
        select: { id: true, name: true, status: true, priority: true, progress: true, targetDate: true, team: true },
        orderBy: { updatedAt: "desc" },
        take: 10,
      }), []),

      // Active 3rd party incidents (active or monitoring)
      safeQuery(() => prisma.incident.findMany({
        where: { status: { in: ["active", "monitoring"] } },
        select: { id: true, title: true, provider: true, severity: true, status: true, startedAt: true },
        orderBy: { startedAt: "desc" },
      }), []),

      // Staking heartbeat summary
      safeQuery(async () => {
        const wallets = await prisma.stakingWallet.findMany({
          where: { status: "active" },
          select: { id: true, asset: true, rewardModel: true, expectedNextRewardAt: true, lastRewardAt: true },
        });
        const now = new Date();
        const overdue = wallets.filter(w => w.expectedNextRewardAt && w.expectedNextRewardAt < now).length;
        const approaching = wallets.filter(w => {
          if (!w.expectedNextRewardAt) return false;
          const hoursUntil = (w.expectedNextRewardAt.getTime() - now.getTime()) / 3600000;
          return hoursUntil > 0 && hoursUntil < 4;
        }).length;
        return { total: wallets.length, overdue, approaching, onTime: wallets.length - overdue - approaching };
      }, { total: 0, overdue: 0, approaching: 0, onTime: 0 }),

      // Today's daily check run
      safeQuery(async () => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const end = new Date(start.getTime() + 86400000);
        const run = await prisma.dailyCheckRun.findFirst({
          where: { date: { gte: start, lt: end } },
          include: { items: { select: { status: true } } },
        });
        if (!run) return { exists: false, total: 0, passed: 0, issues: 0, pending: 0 };
        return {
          exists: true,
          total: run.items.length,
          passed: run.items.filter(i => i.status === "pass").length,
          issues: run.items.filter(i => i.status === "issues_found").length,
          pending: run.items.filter(i => i.status === "pending").length,
        };
      }, { exists: false, total: 0, passed: 0, issues: 0, pending: 0 }),

      // Screening health
      safeQuery(async () => {
        const [notSubmitted, dustCount, scamCount, openAlerts] = await Promise.all([
          prisma.screeningEntry.count({ where: { screeningStatus: "not_submitted", isKnownException: false } }),
          prisma.screeningEntry.count({ where: { classification: "dust" } }),
          prisma.screeningEntry.count({ where: { classification: "scam" } }),
          prisma.screeningEntry.count({ where: { analyticsStatus: { in: ["open", "under_review"] } } }),
        ]);
        return { notSubmitted, dust: dustCount, scam: scamCount, openAlerts };
      }, { notSubmitted: 0, dust: 0, scam: 0, openAlerts: 0 }),

      // RCA tracker
      safeQuery(async () => {
        const rcaIncidents = await prisma.incident.findMany({
          where: { rcaStatus: { not: "none" } },
          select: { id: true, rcaStatus: true, rcaSlaDeadline: true },
        });
        const now = new Date();
        const awaitingCount = rcaIncidents.filter(i => i.rcaStatus === "awaiting_rca").length;
        const overdueCount = rcaIncidents.filter(i => i.rcaStatus === "awaiting_rca" && i.rcaSlaDeadline && i.rcaSlaDeadline < now).length;
        const followUpCount = rcaIncidents.filter(i => i.rcaStatus === "follow_up_pending").length;
        return { total: rcaIncidents.length, awaiting: awaitingCount, overdue: overdueCount, followUp: followUpCount };
      }, { total: 0, awaiting: 0, overdue: 0, followUp: 0 }),
    ]);

    // Travel rule aging: green (<24h), amber (24-48h), red (>48h since creation)
    const casesWithAging = openCases.map((c) => ({
      id: c.id,
      transactionId: c.transactionId,
      asset: c.asset,
      direction: c.direction,
      amount: c.amount,
      matchStatus: c.matchStatus,
      status: c.status,
      ownerUserId: c.ownerUserId,
      createdAt: c.createdAt,
      ...computeTravelRuleAging(c.createdAt),
    }));

    // SLA status: check TTO (time-to-ownership), TTFA (time-to-first-action),
    // TSLA (time-since-last-action) deadlines against current time
    const threadsWithSla = activeThreads.map((t) => ({
      id: t.id,
      subject: t.subject,
      priority: t.priority,
      status: t.status,
      ownerName: (t as Record<string, unknown>).owner
        ? ((t as Record<string, unknown>).owner as { name?: string })?.name ?? null
        : null,
      createdAt: t.createdAt,
      slaStatus: computeSlaStatus({
        createdAt: t.createdAt,
        ownerUserId: t.ownerUserId,
        lastActionAt: t.lastActionAt,
        status: t.status,
        priority: t.priority,
        ttoDeadline: t.ttoDeadline,
        ttfaDeadline: t.ttfaDeadline,
        tslaDeadline: t.tslaDeadline,
      }),
    }));

    const breachedThreads = threadsWithSla.filter(
      (t) => t.slaStatus.isTtoBreached || t.slaStatus.isTtfaBreached || t.slaStatus.isTslaBreached,
    );

    return NextResponse.json({
      success: true,
      data: {
        travelRule: {
          openCount: openCases.length,
          redCount: casesWithAging.filter((c) => c.agingStatus === "red").length,
          amberCount: casesWithAging.filter((c) => c.agingStatus === "amber").length,
          topUrgent: casesWithAging.slice(0, 5),
        },
        comms: {
          totalActive: activeThreads.length,
          breachedCount: breachedThreads.length,
          unassignedCount: activeThreads.filter((t) => t.status === "Unassigned").length,
          topBreached: breachedThreads.slice(0, 5),
        },
        alerts: {
          activeCount: activeAlerts.length,
          items: activeAlerts,
        },
        recentActivity: recentAudit.map((a) => ({
          id: a.id,
          action: a.action,
          entityType: a.entityType,
          entityId: a.entityId,
          userName: (a as Record<string, unknown>).user
            ? ((a as Record<string, unknown>).user as { name?: string })?.name ?? "System"
            : "System",
          details: a.details,
          createdAt: a.createdAt,
        })),
        dailyTasks: {
          total: todaysTasks.length,
          completed: todaysTasks.filter((t) => t.status === "completed").length,
          pending: todaysTasks.filter((t) => t.status === "pending").length,
          inProgress: todaysTasks.filter((t) => t.status === "in_progress").length,
          urgent: todaysTasks.filter((t) => t.priority === "urgent" || t.priority === "high").length,
        },
        coverage: activityCoverage,
        projects: {
          activeCount: activeProjects.filter((p) => p.status === "active").length,
          onHoldCount: activeProjects.filter((p) => p.status === "on_hold").length,
          overdueCount: activeProjects.filter((p) => p.targetDate && new Date(p.targetDate) < new Date() && p.status === "active").length,
          items: activeProjects.map((p) => ({
            id: p.id,
            name: p.name,
            status: p.status,
            priority: p.priority,
            progress: p.progress,
            targetDate: p.targetDate,
            team: p.team,
          })),
        },
        incidents: {
          activeCount: activeIncidents.filter((i) => i.status === "active").length,
          monitoringCount: activeIncidents.filter((i) => i.status === "monitoring").length,
          criticalCount: activeIncidents.filter((i) => i.severity === "critical" && i.status === "active").length,
          items: activeIncidents,
        },
        staking: stakingHeartbeat,
        dailyChecks: dailyCheckStatus,
        screening: screeningHealth,
        rca: rcaStatus,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}
