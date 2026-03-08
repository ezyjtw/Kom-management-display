/**
 * GET /api/scores/overview
 *
 * Dashboard overview: aggregated scores for all visible employees
 * for the latest period of the requested type.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeOverallScore, getActiveScoringConfig } from "@/lib/scoring";
import { requireAuth } from "@/lib/auth-user";
import { checkAuthorization, applyScopeFilter } from "@/modules/auth/services/authorization";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import type { Category } from "@/types";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = checkAuthorization(auth, "score", "view");
  if (!authz.allowed && !checkAuthorization(auth, "score", "view_own").allowed) {
    return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const periodType = searchParams.get("periodType") || "month";
    const teamFilter = searchParams.get("team");
    const regionFilter = searchParams.get("region");

    // Get latest period
    const latestPeriod = await prisma.timePeriod.findFirst({
      where: { type: periodType as never },
      orderBy: { startDate: "desc" },
    });

    if (!latestPeriod) {
      return apiSuccess([], { timestamp: new Date().toISOString() });
    }

    // Build employee filter with scope
    const employeeWhere: Record<string, unknown> = { active: true };
    if (teamFilter) employeeWhere.team = teamFilter;
    if (regionFilter) employeeWhere.region = regionFilter;

    // Apply role-based scope
    if (authz.scope === "own" && auth.employeeId) {
      employeeWhere.id = auth.employeeId;
    } else if (authz.scope === "team" && auth.team) {
      employeeWhere.team = auth.team;
    }

    // Batch fetch: current + previous period scores
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
      ? await prisma.categoryScore.findMany({
          where: { periodId: previousPeriod.id },
        })
      : [];

    const config = await getActiveScoringConfig();
    const categories: Category[] = ["daily_tasks", "projects", "asset_actions", "quality", "knowledge"];

    // Build employee overviews
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

    const overviews = Array.from(employeeMap.values()).map(({ employee, current, previous }) => {
      const categoryScores = {} as Record<Category, number>;
      const trends = {} as Record<string, { current: number; previous: number; delta: number; direction: string }>;

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

      // Generate flags
      const flags: { type: string; message: string; severity: string }[] = [];
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
        active: employee.active,
        overallScore,
        categoryScores,
        trends,
        flags,
      };
    });

    return apiSuccess(overviews, {
      timestamp: new Date().toISOString(),
      period: latestPeriod as unknown as undefined,
      previousPeriod: previousPeriod ? { id: previousPeriod.id, label: previousPeriod.label } as unknown as undefined : undefined,
    });
  } catch (error) {
    return handleApiError(error, "scores/overview");
  }
}
