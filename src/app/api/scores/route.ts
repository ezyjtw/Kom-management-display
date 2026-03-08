import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireRole } from "@/lib/auth-user";
import { createScoreSchema, validateBody } from "@/lib/validation";
import { checkAuthorization } from "@/modules/auth/services/authorization";
import { scoringService } from "@/modules/scoring/services/scoring-service";
import { scoreRepository } from "@/modules/scoring/repositories/score-repository";
import { createAuditEntry } from "@/lib/api/audit";
import { apiSuccess, apiValidationError, apiForbiddenError, handleApiError } from "@/lib/api/response";
import type { Category } from "@/types";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  // Accept both "view" and "view_own" — scope filtering handles visibility
  const authz = checkAuthorization(auth, "score", "view");
  if (!authz.allowed) {
    // Fall back to view_own for employee-role users
    const authzOwn = checkAuthorization(auth, "score", "view_own" as never);
    if (!authzOwn.allowed) return apiForbiddenError(authz.reason);
    // Use own scope for employees
    Object.assign(authz, { allowed: true, scope: authzOwn.scope });
  }

  try {
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get("employeeId");
    const periodId = searchParams.get("periodId");
    const periodType = searchParams.get("periodType") || "month";

    // If specific employee or period requested, return filtered scores
    if (employeeId || periodId) {
      if (employeeId) {
        const { scores } = await scoreRepository.getScoresForEmployee(employeeId, {});
        return apiSuccess(scores);
      }
      if (periodId) {
        const { scores } = await scoreRepository.getScoresForPeriod(periodId, {});
        return apiSuccess(scores);
      }
    }

    // Overview mode: get latest period scores with trends
    let latestPeriod;
    try {
      latestPeriod = await scoreRepository.getLatestPeriod(periodType);
    } catch (err) {
      console.error("Failed to fetch latest period:", err);
      return apiSuccess([]);
    }
    if (!latestPeriod) {
      // No scoring periods yet — return employees with default scores
      const employeeWhere: Record<string, unknown> = { active: true };
      if (authz.scope === "own" && (auth as { employeeId?: string }).employeeId) {
        employeeWhere.id = (auth as { employeeId?: string }).employeeId;
      } else if (authz.scope === "team" && (auth as { team?: string }).team) {
        employeeWhere.team = (auth as { team?: string }).team;
      }
      const employees = await prisma.employee.findMany({ where: employeeWhere });
      const config = await scoringService.getActiveScoringConfig();
      const categories: Category[] = ["daily_tasks", "projects", "asset_actions", "quality", "knowledge"];
      const fallbackOverviews = employees.map((emp) => {
        const categoryScores = {} as Record<Category, number>;
        const trends = {} as Record<string, { current: number; previous: number; delta: number; direction: string }>;
        for (const cat of categories) {
          categoryScores[cat] = 3;
          trends[cat] = { current: 3, previous: 3, delta: 0, direction: "flat" };
        }
        const overallScore = scoringService.computeOverallScore(categoryScores, config.weights);
        trends["overall"] = { current: overallScore, previous: overallScore, delta: 0, direction: "flat" };
        return {
          id: emp.id, name: emp.name, role: emp.role, team: emp.team,
          region: emp.region ?? "", overallScore, categoryScores, trends, flags: [],
        };
      });
      return apiSuccess(fallbackOverviews);
    }

    // Build scope filter so leads/employees only see their own data
    const employeeWhere: Record<string, unknown> = { active: true };
    if (authz.scope === "own" && (auth as { employeeId?: string }).employeeId) {
      employeeWhere.id = (auth as { employeeId?: string }).employeeId;
    } else if (authz.scope === "team" && (auth as { team?: string }).team) {
      employeeWhere.team = (auth as { team?: string }).team;
    }

    const [previousPeriod, periodScoresResult, config, employees] = await Promise.all([
      scoreRepository.getPreviousPeriod(periodType, latestPeriod.startDate).catch(() => null),
      scoreRepository.getScoresForPeriod(latestPeriod.id).catch(() => ({ scores: [], total: 0 })),
      scoringService.getActiveScoringConfig(),
      prisma.employee.findMany({ where: employeeWhere }),
    ]);

    const periodScores = periodScoresResult.scores;
    const prevScores = previousPeriod
      ? await scoreRepository.getScoresForPeriod(previousPeriod.id).then(r => r.scores).catch(() => [])
      : [];

    // Build employee overviews — start from all active employees so those
    // without scores in the current period still appear (with defaults)
    const employeeMap = new Map<string, {
      employee: { id: string; name: string; role: string; team: string; region?: string };
      current: Record<string, number>;
      previous: Record<string, number>;
    }>();

    for (const emp of employees) {
      employeeMap.set(emp.id, {
        employee: emp,
        current: {},
        previous: {},
      });
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

    const categories: Category[] = ["daily_tasks", "projects", "asset_actions", "quality", "knowledge"];

    const overviews = Array.from(employeeMap.values()).map(({ employee, current, previous }) => {
      const categoryScores = {} as Record<Category, number>;
      const trends = {} as Record<string, { current: number; previous: number; delta: number; direction: string }>;

      for (const cat of categories) {
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

      const overallScore = scoringService.computeOverallScore(categoryScores, config.weights);
      const prevCategoryScores = {} as Record<Category, number>;
      for (const cat of categories) {
        prevCategoryScores[cat] = previous[cat] ?? 3;
      }
      const prevOverall = scoringService.computeOverallScore(prevCategoryScores, config.weights);
      const overallDelta = Math.round((overallScore - prevOverall) * 10) / 10;
      trends["overall"] = {
        current: overallScore,
        previous: prevOverall,
        delta: overallDelta,
        direction: overallDelta > 0 ? "up" : overallDelta < 0 ? "down" : "flat",
      };

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

      return {
        id: employee.id,
        name: employee.name,
        role: employee.role,
        team: employee.team,
        region: (employee as Record<string, unknown>).region ?? "",
        overallScore,
        categoryScores,
        trends,
        flags,
      };
    });

    return apiSuccess(overviews, { period: latestPeriod } as never);
  } catch (error) {
    return handleApiError(error, "GET /api/scores");
  }
}

/**
 * POST /api/scores
 * Create or update a category score. Admin or lead only.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole("admin", "lead");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const validated = validateBody(createScoreSchema, body);
    if (!validated.success) {
      return apiValidationError(validated.error);
    }
    const { employeeId, periodId, category, rawIndex, evidence, metadata } = validated.data;

    const config = await scoringService.getActiveScoringConfig();
    const score = scoringService.rawIndexToScore(rawIndex);

    const categoryScore = await scoreRepository.upsertScore({
      employeeId,
      periodId,
      category,
      rawIndex,
      score,
      configVersion: config.version,
      evidence: (evidence || []) as Prisma.InputJsonValue,
      metadata: (metadata || {}) as Prisma.InputJsonValue,
    });

    await createAuditEntry({
      action: "score_updated",
      entityType: "score",
      entityId: categoryScore.id,
      userId: auth.id,
      summary: `Score updated for employee ${employeeId}, category ${category}`,
      after: { employeeId, periodId, category, rawIndex, score },
    });

    return apiSuccess(categoryScore);
  } catch (error) {
    return handleApiError(error, "POST /api/scores");
  }
}
