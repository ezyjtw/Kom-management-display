import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rawIndexToScore, computeOverallScore, getDefaultScoringConfig } from "@/lib/scoring";
import type { Category } from "@/types";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get("employeeId");
    const periodId = searchParams.get("periodId");
    const periodType = searchParams.get("periodType") || "month";

    const where: Record<string, unknown> = {};
    if (employeeId) where.employeeId = employeeId;
    if (periodId) where.periodId = periodId;

    const scores = await prisma.categoryScore.findMany({
      where,
      include: {
        employee: true,
        period: true,
      },
      orderBy: { period: { startDate: "desc" } },
    });

    // Group scores by employee for the overview
    if (!employeeId && !periodId) {
      // Get latest period
      const latestPeriod = await prisma.timePeriod.findFirst({
        where: { type: periodType },
        orderBy: { startDate: "desc" },
      });

      if (!latestPeriod) {
        return NextResponse.json({ success: true, data: [] });
      }

      const periodScores = await prisma.categoryScore.findMany({
        where: { periodId: latestPeriod.id },
        include: { employee: true },
      });

      // Get previous period for trends
      const previousPeriod = await prisma.timePeriod.findFirst({
        where: {
          type: periodType,
          startDate: { lt: latestPeriod.startDate },
        },
        orderBy: { startDate: "desc" },
      });

      const prevScores = previousPeriod
        ? await prisma.categoryScore.findMany({
            where: { periodId: previousPeriod.id },
          })
        : [];

      const config = getDefaultScoringConfig();

      // Build employee overviews
      const employeeMap = new Map<string, {
        employee: typeof periodScores[0]["employee"];
        current: Record<string, number>;
        previous: Record<string, number>;
      }>();

      for (const s of periodScores) {
        if (!employeeMap.has(s.employeeId)) {
          employeeMap.set(s.employeeId, {
            employee: s.employee,
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

      const overviews = Array.from(employeeMap.values()).map(({ employee, current, previous }) => {
        const categories: Category[] = ["daily_tasks", "projects", "asset_actions", "quality", "knowledge"];
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

        const overallScore = computeOverallScore(categoryScores, config.weights);
        const prevCategoryScores = {} as Record<Category, number>;
        for (const cat of categories) {
          prevCategoryScores[cat] = previous[cat] ?? 3;
        }
        const prevOverall = computeOverallScore(prevCategoryScores, config.weights);
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
          region: employee.region,
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
    }

    return NextResponse.json({ success: true, data: scores });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { employeeId, periodId, category, rawIndex, evidence, metadata } = body;

    if (!employeeId || !periodId || !category || rawIndex === undefined) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const config = getDefaultScoringConfig();
    const score = rawIndexToScore(rawIndex);

    const categoryScore = await prisma.categoryScore.upsert({
      where: {
        employeeId_periodId_category: { employeeId, periodId, category },
      },
      update: {
        rawIndex,
        score,
        configVersion: config.version,
        evidence: JSON.stringify(evidence || []),
        metadata: JSON.stringify(metadata || {}),
      },
      create: {
        employeeId,
        periodId,
        category,
        rawIndex,
        score,
        configVersion: config.version,
        evidence: JSON.stringify(evidence || []),
        metadata: JSON.stringify(metadata || {}),
      },
    });

    return NextResponse.json({ success: true, data: categoryScore });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
