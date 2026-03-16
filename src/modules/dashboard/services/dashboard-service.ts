/**
 * Dashboard Aggregation Service
 *
 * Server-side data loading for the dashboard page. Centralizes all Prisma
 * queries, scoring computation, and ops data aggregation that was previously
 * inlined in the page component.
 */
import { prisma } from "@/lib/prisma";
import { computeOverallScore, getActiveScoringConfig } from "@/lib/scoring";
import { computeTravelRuleAging } from "@/lib/sla";
import type { Category, CategoryWeight, EmployeeOverview } from "@/types";
import { logger } from "@/lib/logger";

// ─── Types ───

export interface OpsData {
  comms: { totalActive: number; breachedCount: number; unassignedCount: number };
  travelRule: { openCount: number; redCount: number; amberCount: number };
  alerts: { activeCount: number };
  incidents: { activeCount: number; criticalCount: number; monitoringCount: number };
  dailyChecks: { exists: boolean; total: number; passed: number; issues: number; pending: number };
  staking: { overdue: number; approaching: number };
  coverage: { total: number; active: number; onQueues: number; onBreak: number };
  rca?: { awaiting: number; overdue: number; followUp: number };
  screening?: { notSubmitted: number; openAlerts: number };
  _errors?: string[];
}

export interface DashboardData {
  employees: EmployeeOverview[];
  opsData: OpsData | null;
}

interface DashboardUser {
  role: string;
  employeeId?: string;
  team?: string;
}

// ─── Service ───

export const dashboardService = {
  /**
   * Load all dashboard data for a given user and period type.
   * Handles employee scoping by role, score computation, trend analysis,
   * flag generation, and ops data aggregation.
   */
  async loadDashboardData(
    user: DashboardUser,
    periodType: string = "month",
  ): Promise<DashboardData> {
    try {
      const [employeeData, opsData] = await Promise.all([
        loadEmployeeScores(user, periodType),
        loadOpsData(),
      ]);
      return { employees: employeeData, opsData };
    } catch (error) {
      logger.error("dashboardService.loadDashboardData failed", { error: error instanceof Error ? error.message : String(error) });
      return { employees: [], opsData: null };
    }
  },
};

// ─── Internal Helpers ───

const CATEGORIES: Category[] = [
  "daily_tasks",
  "projects",
  "asset_actions",
  "quality",
  "knowledge",
];

async function loadEmployeeScores(
  user: DashboardUser,
  periodType: string,
): Promise<EmployeeOverview[]> {
  const latestPeriod = await prisma.timePeriod.findFirst({
    where: { type: periodType as never },
    orderBy: { startDate: "desc" },
  });

  // Build employee filter with role-based scope
  const employeeWhere: Record<string, unknown> = { active: true };
  if (user.role === "employee" && user.employeeId) {
    employeeWhere.id = user.employeeId;
  } else if (user.role === "lead" && user.team) {
    employeeWhere.team = user.team;
  }

  // If no scoring period exists, fall back to showing employees with default scores
  if (!latestPeriod) {
    const employees = await prisma.employee.findMany({ where: employeeWhere });
    const config = await getActiveScoringConfig();
    return employees.map((emp) =>
      buildEmployeeOverview(emp, {}, {}, config.weights),
    );
  }

  const [employees, periodScores, previousPeriod, config] = await Promise.all([
    prisma.employee.findMany({ where: employeeWhere }),
    prisma.categoryScore.findMany({
      where: { periodId: latestPeriod.id, employee: employeeWhere },
    }),
    prisma.timePeriod.findFirst({
      where: { type: periodType as never, startDate: { lt: latestPeriod.startDate } },
      orderBy: { startDate: "desc" },
    }),
    getActiveScoringConfig(),
  ]);

  const prevScores = previousPeriod
    ? await prisma.categoryScore.findMany({ where: { periodId: previousPeriod.id } })
    : [];

  // Group scores by employee, starting from all active employees
  const employeeMap = new Map<string, {
    employee: { id: string; name: string; role: string; team: string; region: string };
    current: Record<string, number>;
    previous: Record<string, number>;
  }>();

  for (const emp of employees) {
    employeeMap.set(emp.id, { employee: emp, current: {}, previous: {} });
  }

  for (const s of periodScores) {
    if (employeeMap.has(s.employeeId)) {
      employeeMap.get(s.employeeId)!.current[s.category] = s.score;
    }
  }

  for (const s of prevScores) {
    if (employeeMap.has(s.employeeId)) {
      employeeMap.get(s.employeeId)!.previous[s.category] = s.score;
    }
  }

  return Array.from(employeeMap.values()).map(({ employee, current, previous }) =>
    buildEmployeeOverview(employee, current, previous, config.weights),
  );
}

function buildEmployeeOverview(
  employee: { id: string; name: string; role: string; team: string; region: string },
  current: Record<string, number>,
  previous: Record<string, number>,
  weights: CategoryWeight,
): EmployeeOverview {
  const categoryScores = {} as Record<Category, number>;
  const trends = {} as Record<string, { current: number; previous: number; delta: number; direction: "up" | "down" | "flat" }>;

  for (const cat of CATEGORIES) {
    categoryScores[cat] = current[cat] ?? 3;
    const prev = previous[cat] ?? current[cat] ?? 3;
    const delta = Math.round((categoryScores[cat] - prev) * 10) / 10;
    trends[cat] = {
      current: categoryScores[cat],
      previous: prev,
      delta,
      direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    };
  }

  const overallScore = computeOverallScore(categoryScores, weights);
  const prevCategoryScores = {} as Record<Category, number>;
  for (const cat of CATEGORIES) prevCategoryScores[cat] = previous[cat] ?? 3;
  const prevOverall = computeOverallScore(prevCategoryScores, weights);
  const overallDelta = Math.round((overallScore - prevOverall) * 10) / 10;
  trends["overall"] = {
    current: overallScore,
    previous: prevOverall,
    delta: overallDelta,
    direction: overallDelta > 0 ? "up" : overallDelta < 0 ? "down" : "flat",
  };

  const flags = generateFlags(categoryScores, trends, overallScore);

  return {
    id: employee.id,
    name: employee.name,
    role: employee.role,
    team: employee.team,
    region: employee.region,
    overallScore,
    categoryScores,
    trends: trends as EmployeeOverview["trends"],
    flags: flags as EmployeeOverview["flags"],
  };
}

function generateFlags(
  categoryScores: Record<Category, number>,
  trends: Record<string, { delta: number; direction: string }>,
  overallScore: number,
): { type: string; message: string; severity: "warning" | "critical" }[] {
  const flags: { type: string; message: string; severity: "warning" | "critical" }[] = [];

  if (trends["quality"]?.direction === "down" && trends["quality"].delta < -0.5) {
    flags.push({ type: "mistakes_rising", message: "Quality score declining", severity: "warning" });
  }
  if (trends["daily_tasks"]?.direction === "down" && trends["daily_tasks"].delta < -0.5) {
    flags.push({ type: "throughput_drop", message: "Task throughput dropping", severity: "warning" });
  }
  if ((categoryScores["projects"] ?? 3) <= 3.5) {
    flags.push({ type: "docs_stalled", message: "Documentation stalled", severity: "warning" });
  }
  if (overallScore <= 4.0) {
    flags.push({ type: "sla_slipping", message: "Overall performance below threshold", severity: "critical" });
  }

  return flags;
}

async function loadOpsData(): Promise<OpsData | null> {
  const errors: string[] = [];

  // Wraps each query so one failure doesn't break the whole dashboard
  async function safeQuery<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try { return await fn(); } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Ops ${label} query failed`, { error: msg });
      errors.push(label);
      return fallback;
    }
  }

  try {
    // Quick DB connectivity check — if this fails, everything will be zeros
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      logger.error("Ops database unreachable", { error: err instanceof Error ? err.message : String(err) });
      return {
        comms: { totalActive: 0, breachedCount: 0, unassignedCount: 0 },
        travelRule: { openCount: 0, redCount: 0, amberCount: 0 },
        alerts: { activeCount: 0 },
        incidents: { activeCount: 0, criticalCount: 0, monitoringCount: 0 },
        dailyChecks: { exists: false, total: 0, passed: 0, issues: 0, pending: 0 },
        staking: { overdue: 0, approaching: 0 },
        coverage: { total: 0, active: 0, onQueues: 0, onBreak: 0 },
        _errors: ["Database unreachable — all metrics may be stale or zero"],
      };
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 86400000);

    const [
      activeThreadCount,
      breachedThreads,
      unassignedThreads,
      openTravelRuleCases,
      activeAlerts,
      activeIncidents,
      criticalIncidents,
      monitoringIncidents,
      totalEmployees,
      activeEmployees,
      stakingWallets,
      dailyCheckRun,
      screeningData,
      rcaData,
    ] = await Promise.all([
      safeQuery("comms.active", () => prisma.commsThread.count({ where: { status: { notIn: ["Done", "Closed"] } } }), 0),
      safeQuery("comms.breached", () => prisma.commsThread.count({
        where: {
          status: { notIn: ["Done", "Closed"] },
          OR: [
            { ttoDeadline: { lt: now } },
            { ttfaDeadline: { lt: now } },
            { tslaDeadline: { lt: now } },
          ],
        },
      }), 0),
      safeQuery("comms.unassigned", () => prisma.commsThread.count({ where: { status: "Unassigned" } }), 0),
      safeQuery("travelRule", () => prisma.travelRuleCase.findMany({
        where: { status: { not: "Resolved" } },
        select: { createdAt: true },
      }), []),
      safeQuery("alerts", () => prisma.alert.count({ where: { status: "active" } }), 0),
      safeQuery("incidents.active", () => prisma.incident.count({ where: { status: "active" } }), 0),
      safeQuery("incidents.critical", () => prisma.incident.count({ where: { status: "active", severity: "critical" } }), 0),
      safeQuery("incidents.monitoring", () => prisma.incident.count({ where: { status: "monitoring" } }), 0),
      safeQuery("coverage.total", () => prisma.employee.count(), 0),
      safeQuery("coverage.active", () => prisma.employee.count({ where: { active: true } }), 0),
      safeQuery("staking", () => prisma.stakingWallet.findMany({
        where: { status: "active" },
        select: { expectedNextRewardAt: true },
      }), []),
      safeQuery("dailyChecks", async () => {
        const run = await prisma.dailyCheckRun.findFirst({
          where: { date: { gte: todayStart, lt: todayEnd } },
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
      safeQuery("screening", async () => {
        const [notSubmitted, openAlerts] = await Promise.all([
          prisma.screeningEntry.count({ where: { screeningStatus: "not_submitted", isKnownException: false } }),
          prisma.screeningEntry.count({ where: { analyticsStatus: { in: ["open", "under_review"] } } }),
        ]);
        return { notSubmitted, openAlerts };
      }, { notSubmitted: 0, openAlerts: 0 }),
      safeQuery("rca", async () => {
        const rcaIncidents = await prisma.incident.findMany({
          where: { rcaStatus: { not: "none" } },
          select: { rcaStatus: true, rcaSlaDeadline: true },
        });
        return {
          awaiting: rcaIncidents.filter(i => i.rcaStatus === "awaiting_rca").length,
          overdue: rcaIncidents.filter(i => i.rcaStatus === "awaiting_rca" && i.rcaSlaDeadline && i.rcaSlaDeadline < now).length,
          followUp: rcaIncidents.filter(i => i.rcaStatus === "follow_up_pending").length,
        };
      }, { awaiting: 0, overdue: 0, followUp: 0 }),
    ]);

    // Compute travel rule aging
    const casesWithAging = openTravelRuleCases.map(c => computeTravelRuleAging(c.createdAt));
    const redCount = casesWithAging.filter(c => c.agingStatus === "red").length;
    const amberCount = casesWithAging.filter(c => c.agingStatus === "amber").length;

    // Compute staking overdue/approaching
    const stakingOverdue = stakingWallets.filter(w => w.expectedNextRewardAt && w.expectedNextRewardAt < now).length;
    const stakingApproaching = stakingWallets.filter(w => {
      if (!w.expectedNextRewardAt) return false;
      const hoursUntil = (w.expectedNextRewardAt.getTime() - now.getTime()) / 3600000;
      return hoursUntil > 0 && hoursUntil < 4;
    }).length;

    return {
      comms: { totalActive: activeThreadCount, breachedCount: breachedThreads, unassignedCount: unassignedThreads },
      travelRule: { openCount: openTravelRuleCases.length, redCount, amberCount },
      alerts: { activeCount: activeAlerts },
      incidents: { activeCount: activeIncidents, criticalCount: criticalIncidents, monitoringCount: monitoringIncidents },
      dailyChecks: dailyCheckRun,
      staking: { overdue: stakingOverdue, approaching: stakingApproaching },
      coverage: { total: totalEmployees, active: activeEmployees, onQueues: 0, onBreak: 0 },
      rca: rcaData,
      screening: screeningData,
      _errors: errors.length > 0 ? errors : undefined,
    };
  } catch (err) {
    logger.error("Ops loadOpsData failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
