import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth-user";
import { createScoreSchema, validateBody } from "@/lib/validation";
import { checkAuthorization, applyScopeFilter } from "@/modules/auth/services/authorization";
import { scoringService } from "@/modules/scoring/services/scoring-service";
import { scoreRepository } from "@/modules/scoring/repositories/score-repository";
import { createAuditEntry } from "@/lib/api/audit";
import { apiSuccess, apiValidationError, apiForbiddenError, handleApiError } from "@/lib/api/response";
import type { Category } from "@/types";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = checkAuthorization(auth, "score", "view");
  if (!authz.allowed) return apiForbiddenError(authz.reason);

  try {
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get("employeeId");
    const periodId = searchParams.get("periodId");
    const periodType = searchParams.get("periodType") || "month";

    // If specific employee or period requested, return filtered scores
    if (employeeId || periodId) {
      const where = applyScopeFilter(auth, authz.scope, {}, { employeeIdField: "employeeId" });
      if (employeeId) where.employeeId = employeeId;
      if (periodId) where.periodId = periodId;

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
    const latestPeriod = await scoreRepository.getLatestPeriod(periodType);
    if (!latestPeriod) {
      return apiSuccess([]);
    }

    const previousPeriod = await scoreRepository.getPreviousPeriod(periodType, latestPeriod.startDate);
    const { scores: periodScores } = await scoreRepository.getScoresForPeriod(latestPeriod.id);
    const prevScores = previousPeriod
      ? (await scoreRepository.getScoresForPeriod(previousPeriod.id)).scores
      : [];

    const config = await scoringService.getActiveScoringConfig();

    // Build employee overviews
    const employeeMap = new Map<string, {
      employee: { id: string; name: string; role: string; team: string; region?: string };
      current: Record<string, number>;
      previous: Record<string, number>;
    }>();

    for (const s of periodScores) {
      if (!employeeMap.has(s.employeeId)) {
        employeeMap.set(s.employeeId, {
          employee: s.employee ?? { id: s.employeeId, name: "", role: "", team: "" },
          current: {},
          previous: {},
        });
      }
      employeeMap.get(s.employeeId)!.current[s.category] = s.score;
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

    return NextResponse.json({
      success: true,
      data: overviews,
      period: latestPeriod,
    });
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
      evidence: evidence || [],
      metadata: metadata || {},
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
