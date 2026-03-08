/**
 * Dashboard Aggregation Service
 *
 * Server-side data loading for the dashboard page. Centralizes all Prisma
 * queries, scoring computation, and ops data aggregation that was previously
 * inlined in the page component.
 */
import { prisma } from "@/lib/prisma";
import { computeOverallScore, getActiveScoringConfig } from "@/lib/scoring";
import type { Category, CategoryWeight, EmployeeOverview } from "@/types";

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
      console.error("dashboardService.loadDashboardData failed:", error);
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
  try {
    const now = new Date();

    const [
      activeThreadCount,
      breachedThreads,
      unassignedThreads,
      openTravelRule,
      activeAlerts,
      activeIncidents,
      criticalIncidents,
      totalEmployees,
      activeEmployees,
    ] = await Promise.all([
      prisma.commsThread.count({ where: { status: { notIn: ["Done", "Closed"] } } }),
      prisma.commsThread.count({
        where: {
          status: { notIn: ["Done", "Closed"] },
          OR: [
            { ttoDeadline: { lt: now } },
            { ttfaDeadline: { lt: now } },
            { tslaDeadline: { lt: now } },
          ],
        },
      }),
      prisma.commsThread.count({ where: { status: "Unassigned" } }),
      prisma.travelRuleCase.count({ where: { status: { notIn: ["Resolved"] } } }),
      prisma.alert.count({ where: { status: "active" } }),
      prisma.incident.count({ where: { status: "active" } }),
      prisma.incident.count({ where: { status: "active", severity: "critical" } }),
      prisma.employee.count(),
      prisma.employee.count({ where: { active: true } }),
    ]);

    return {
      comms: { totalActive: activeThreadCount, breachedCount: breachedThreads, unassignedCount: unassignedThreads },
      travelRule: { openCount: openTravelRule, redCount: 0, amberCount: 0 },
      alerts: { activeCount: activeAlerts },
      incidents: { activeCount: activeIncidents, criticalCount: criticalIncidents, monitoringCount: 0 },
      dailyChecks: { exists: false, total: 0, passed: 0, issues: 0, pending: 0 },
      staking: { overdue: 0, approaching: 0 },
      coverage: { total: totalEmployees, active: activeEmployees, onQueues: 0, onBreak: 0 },
    };
  } catch {
    return null;
  }
}
