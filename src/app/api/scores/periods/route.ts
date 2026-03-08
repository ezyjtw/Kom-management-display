/**
 * GET /api/scores/periods
 *
 * List available scoring periods with basic stats.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { apiSuccess, handleApiError } from "@/lib/api/response";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "month";
    const limit = Math.min(parseInt(searchParams.get("limit") || "12", 10), 52);

    const periods = await prisma.timePeriod.findMany({
      where: { type: type as never },
      orderBy: { startDate: "desc" },
      take: limit,
    });

    // Get score counts per period
    const periodIds = periods.map((p) => p.id);
    const scoreCounts = await prisma.categoryScore.groupBy({
      by: ["periodId"],
      where: { periodId: { in: periodIds } },
      _count: { id: true },
    });

    const countMap = new Map(scoreCounts.map((c) => [c.periodId, c._count.id]));

    const result = periods.map((p) => ({
      id: p.id,
      type: p.type,
      label: p.label,
      startDate: p.startDate,
      endDate: p.endDate,
      scoreCount: countMap.get(p.id) || 0,
    }));

    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error, "scores/periods");
  }
}
