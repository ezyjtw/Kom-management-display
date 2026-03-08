/**
 * GET /api/scores/employee/:id
 *
 * Detailed score view for a single employee including:
 * - All category scores with evidence
 * - Score history across periods
 * - Score explanation (raw inputs, targets, config version)
 * - Knowledge scores
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeOverallScore, getActiveScoringConfig } from "@/lib/scoring";
import { requireAuth } from "@/lib/auth-user";
import { checkAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, apiNotFoundError, handleApiError, apiForbiddenError } from "@/lib/api/response";
import type { Category } from "@/types";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  // Check authorization
  const authz = checkAuthorization(auth, "score", "view");
  if (!authz.allowed) {
    // Employees can view their own scores
    if (auth.role === "employee" && auth.employeeId === id) {
      // OK - viewing own
    } else {
      return apiForbiddenError();
    }
  }

  // Team scope check for leads
  if (authz.scope === "team" && auth.team) {
    const employee = await prisma.employee.findUnique({ where: { id }, select: { team: true } });
    if (employee && employee.team !== auth.team) {
      return apiForbiddenError("Cannot view scores for employees outside your team");
    }
  }

  try {
    const { searchParams } = new URL(request.url);
    const periodType = searchParams.get("periodType") || "month";
    const limit = parseInt(searchParams.get("limit") || "6", 10);

    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) return apiNotFoundError("Employee");

    // Get recent periods
    const periods = await prisma.timePeriod.findMany({
      where: { type: periodType },
      orderBy: { startDate: "desc" },
      take: limit,
    });

    // Get all scores for those periods
    const scores = await prisma.categoryScore.findMany({
      where: {
        employeeId: id,
        periodId: { in: periods.map((p) => p.id) },
      },
      include: { period: true },
      orderBy: { period: { startDate: "desc" } },
    });

    // Get knowledge scores
    const knowledgeScores = await prisma.knowledgeScore.findMany({
      where: {
        employeeId: id,
        periodId: { in: periods.map((p) => p.id) },
      },
      include: { period: true },
      orderBy: { period: { startDate: "desc" } },
    });

    // Get employee notes
    const notes = await prisma.employeeNote.findMany({
      where: { employeeId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    const config = await getActiveScoringConfig();
    const categories: Category[] = ["daily_tasks", "projects", "asset_actions", "quality", "knowledge"];

    // Build score history per period
    const history = periods.map((period) => {
      const periodScores = scores.filter((s) => s.periodId === period.id);
      const categoryScores = {} as Record<Category, number>;
      const categoryDetails = {} as Record<string, {
        score: number;
        rawIndex: number;
        evidence: unknown[];
        metadata: Record<string, unknown>;
        configVersion: string;
      }>;

      for (const cat of categories) {
        const s = periodScores.find((ps) => ps.category === cat);
        categoryScores[cat] = s?.score ?? 3;
        categoryDetails[cat] = {
          score: s?.score ?? 3,
          rawIndex: s?.rawIndex ?? 0,
          evidence: s ? JSON.parse(s.evidence) : [],
          metadata: s ? JSON.parse(s.metadata) : {},
          configVersion: s?.configVersion ?? config.version,
        };
      }

      const ks = knowledgeScores.find((k) => k.periodId === period.id);

      return {
        period: { id: period.id, label: period.label, type: period.type, startDate: period.startDate, endDate: period.endDate },
        overallScore: computeOverallScore(categoryScores, config.weights),
        categoryScores,
        categoryDetails,
        knowledgeScore: ks ? {
          operationalUnderstanding: ks.operationalUnderstanding,
          assetKnowledge: ks.assetKnowledge,
          complianceAwareness: ks.complianceAwareness,
          incidentResponse: ks.incidentResponse,
          overallRaw: ks.overallRaw,
          mappedScore: ks.mappedScore,
          scoredBy: ks.scoredBy,
          notes: ks.notes,
        } : null,
      };
    });

    // Score explanation for latest period
    const latestScores = history[0];
    const roleTargets = config.targets[employee.role];
    const explanation = {
      configVersion: config.version,
      weights: config.weights,
      clampRange: { min: config.clampMin, max: config.clampMax },
      roleTargets: roleTargets || null,
      definitions: config.definitions,
      scoringMethod: "rawIndex (0-1) → mapped to 3-8 scale via linear interpolation + clamping",
    };

    return apiSuccess({
      employee: {
        id: employee.id,
        name: employee.name,
        role: employee.role,
        team: employee.team,
        region: employee.region,
        active: employee.active,
      },
      currentPeriod: latestScores || null,
      history,
      explanation,
      notes,
    });
  } catch (error) {
    return handleApiError(error, `scores/employee/${id}`);
  }
}
