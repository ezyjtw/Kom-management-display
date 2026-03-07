import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeOverallScore, getActiveScoringConfig } from "@/lib/scoring";
import { requireRole, safeErrorMessage } from "@/lib/auth-user";
import type { Category } from "@/types";

/**
 * GET /api/export
 * Export performance data as CSV or JSON. Admin or lead only.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole("admin", "lead");
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") || "csv";
    const periodId = searchParams.get("periodId");
    const employeeId = searchParams.get("employeeId");

    if (!periodId) {
      return NextResponse.json(
        { success: false, error: "periodId is required" },
        { status: 400 }
      );
    }

    const where: Record<string, unknown> = { periodId };
    if (employeeId) where.employeeId = employeeId;

    const scores = await prisma.categoryScore.findMany({
      where,
      include: {
        employee: true,
        period: true,
      },
    });

    const config = await getActiveScoringConfig();
    const categories: Category[] = ["daily_tasks", "projects", "asset_actions", "quality", "knowledge"];

    // Group by employee
    const employeeData = new Map<string, {
      name: string;
      role: string;
      team: string;
      scores: Record<string, number>;
    }>();

    for (const s of scores) {
      if (!employeeData.has(s.employeeId)) {
        employeeData.set(s.employeeId, {
          name: s.employee.name,
          role: s.employee.role,
          team: s.employee.team,
          scores: {},
        });
      }
      employeeData.get(s.employeeId)!.scores[s.category] = s.score;
    }

    // Audit: log the export action
    await prisma.auditLog.create({
      data: {
        action: "export",
        entityType: "performance_data",
        entityId: periodId,
        userId: auth.employeeId || auth.id,
        details: JSON.stringify({
          format,
          periodId,
          employeeId: employeeId || "all",
          recordCount: employeeData.size,
        }),
      },
    });

    if (format === "csv") {
      const headers = ["Name", "Role", "Team", ...categories.map(c => c.replace("_", " ")), "Overall"];
      const rows = Array.from(employeeData.values()).map(emp => {
        const catScores = {} as Record<Category, number>;
        for (const cat of categories) {
          catScores[cat] = emp.scores[cat] ?? 3;
        }
        const overall = computeOverallScore(catScores, config.weights);
        return [emp.name, emp.role, emp.team, ...categories.map(c => emp.scores[c]?.toString() ?? "3"), overall.toString()];
      });

      const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");

      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": "attachment; filename=performance-summary.csv",
        },
      });
    }

    // JSON format
    const result = Array.from(employeeData.entries()).map(([id, emp]) => {
      const catScores = {} as Record<Category, number>;
      for (const cat of categories) {
        catScores[cat] = emp.scores[cat] ?? 3;
      }
      const overall = computeOverallScore(catScores, config.weights);
      return { id, ...emp, overall };
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}
