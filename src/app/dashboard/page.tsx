import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";
import { computeOverallScore, getActiveScoringConfig } from "@/lib/scoring";
import type { Category, EmployeeOverview } from "@/types";
import { DashboardClient } from "./DashboardClient";

/**
 * Server component: fetches initial data on the server before render.
 * Auth is enforced server-side — unauthenticated users are redirected.
 * Client component handles filters, refresh, and interactivity.
 */
export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  const user = session.user as { id: string; role: string; employeeId?: string; team?: string };

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      }
    >
      <DashboardDataLoader user={user} />
    </Suspense>
  );
}

interface OpsData {
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

async function DashboardDataLoader({ user }: { user: { id: string; role: string; employeeId?: string; team?: string } }) {
  const initialData = await loadDashboardData(user, "month");

  return (
    <DashboardClient
      initialEmployees={initialData.employees}
      initialOpsData={initialData.opsData}
      userRole={user.role}
    />
  );
}

// ─── Server-side data fetching ───

async function loadDashboardData(
  user: { role: string; employeeId?: string; team?: string },
  periodType: string,
) {
  try {
    const latestPeriod = await prisma.timePeriod.findFirst({
      where: { type: periodType as never },
      orderBy: { startDate: "desc" },
    });

    if (!latestPeriod) {
      return { employees: [] as EmployeeOverview[], opsData: null as OpsData | null };
    }

    // Build employee filter with scope
    const employeeWhere: Record<string, unknown> = { active: true };
    if (user.role === "employee" && user.employeeId) {
      employeeWhere.id = user.employeeId;
    } else if (user.role === "lead" && user.team) {
      employeeWhere.team = user.team;
    }

    const [periodScores, previousPeriod] = await Promise.all([
      prisma.categoryScore.findMany({
        where: { periodId: latestPeriod.id, employee: employeeWhere },
        include: { employee: true },
      }),
      prisma.timePeriod.findFirst({
        where: { type: periodType as never, startDate: { lt: latestPeriod.startDate } },
        orderBy: { startDate: "desc" },
      }),
    ]);

    const prevScores = previousPeriod
      ? await prisma.categoryScore.findMany({ where: { periodId: previousPeriod.id } })
      : [];

    const config = await getActiveScoringConfig();
    const categories: Category[] = ["daily_tasks", "projects", "asset_actions", "quality", "knowledge"];

    const employeeMap = new Map<string, {
      employee: typeof periodScores[0]["employee"];
      current: Record<string, number>;
      previous: Record<string, number>;
    }>();

    for (const s of periodScores) {
      if (!employeeMap.has(s.employeeId)) {
        employeeMap.set(s.employeeId, { employee: s.employee, current: {}, previous: {} });
      }
      employeeMap.get(s.employeeId)!.current[s.category] = s.score;
    }

    for (const s of prevScores) {
      if (employeeMap.has(s.employeeId)) {
        employeeMap.get(s.employeeId)!.previous[s.category] = s.score;
      }
    }

    const employees: EmployeeOverview[] = Array.from(employeeMap.values()).map(({ employee, current, previous }) => {
      const categoryScores = {} as Record<Category, number>;
      const trends = {} as Record<string, { current: number; previous: number; delta: number; direction: "up" | "down" | "flat" }>;

      for (const cat of categories) {
        categoryScores[cat] = current[cat] ?? 3;
        const prev = previous[cat] ?? current[cat] ?? 3;
        const delta = Math.round((categoryScores[cat] - prev) * 10) / 10;
        trends[cat] = { current: categoryScores[cat], previous: prev, delta, direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat" };
      }

      const overallScore = computeOverallScore(categoryScores, config.weights);
      const prevCategoryScores = {} as Record<Category, number>;
      for (const cat of categories) prevCategoryScores[cat] = previous[cat] ?? 3;
      const prevOverall = computeOverallScore(prevCategoryScores, config.weights);
      const overallDelta = Math.round((overallScore - prevOverall) * 10) / 10;
      trends["overall"] = { current: overallScore, previous: prevOverall, delta: overallDelta, direction: overallDelta > 0 ? "up" : overallDelta < 0 ? "down" : "flat" };

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
    });

    // Load ops data in parallel
    const opsData = await loadOpsData();
    return { employees, opsData };
  } catch (error) {
    console.error("Failed to load dashboard data server-side:", error);
    return { employees: [] as EmployeeOverview[], opsData: null as OpsData | null };
  }
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
    ]);

    return {
      comms: { totalActive: activeThreadCount, breachedCount: breachedThreads, unassignedCount: unassignedThreads },
      travelRule: { openCount: openTravelRule, redCount: 0, amberCount: 0 },
      alerts: { activeCount: activeAlerts },
      incidents: { activeCount: activeIncidents, criticalCount: criticalIncidents, monitoringCount: 0 },
      dailyChecks: { exists: false, total: 0, passed: 0, issues: 0, pending: 0 },
      staking: { overdue: 0, approaching: 0 },
      coverage: { total: 0, active: 0, onQueues: 0, onBreak: 0 },
    };
  } catch {
    return null;
  }
}
