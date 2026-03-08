import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeOverallScore, getActiveScoringConfig } from "@/lib/scoring";
import { requireRole } from "@/lib/auth-user";
import { checkAuthorization, applyScopeFilter } from "@/modules/auth/services/authorization";
import { createAuditEntry } from "@/lib/api/audit";
import { handleApiError, apiForbiddenError, apiValidationError } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import type { Category } from "@/types";

/** Maximum rows per export to prevent bulk extraction */
const MAX_EXPORT_ROWS = 10_000;

/**
 * GET /api/export
 *
 * Export performance data as CSV or JSON.
 * - Admin: unrestricted
 * - Lead: team-scoped only
 * - Employee: denied
 * - Auditor: unrestricted (read-only)
 *
 * Every export is audited with user, format, scope, and row count.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole("admin", "lead", "auditor");
  if (auth instanceof NextResponse) return auth;

  const authz = checkAuthorization(auth, "export", "export");
  if (!authz.allowed) return apiForbiddenError("Export access denied");

  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") || "csv";
    const periodId = searchParams.get("periodId");
    const employeeId = searchParams.get("employeeId");

    if (!periodId) {
      return apiValidationError("periodId is required");
    }

    if (!["csv", "json"].includes(format)) {
      return apiValidationError("format must be 'csv' or 'json'");
    }

    // Build scoped query
    const where: Record<string, unknown> = { periodId };
    if (employeeId) where.employeeId = employeeId;

    // Apply team scope for leads
    if (authz.scope === "team" && auth.team) {
      where.employee = { team: auth.team };
    }

    const scores = await prisma.categoryScore.findMany({
      where,
      include: {
        employee: true,
        period: true,
      },
      take: MAX_EXPORT_ROWS * 5, // 5 categories per employee
    });

    const config = await getActiveScoringConfig();
    const categories: Category[] = ["daily_tasks", "projects", "asset_actions", "quality", "knowledge"];

    // Group by employee
    const employeeData = new Map<string, {
      name: string;
      role: string;
      team: string;
      region: string;
      scores: Record<string, number>;
    }>();

    for (const s of scores) {
      if (!employeeData.has(s.employeeId)) {
        employeeData.set(s.employeeId, {
          name: s.employee.name,
          role: s.employee.role,
          team: s.employee.team,
          region: s.employee.region,
          scores: {},
        });
      }
      employeeData.get(s.employeeId)!.scores[s.category] = s.score;
    }

    // Enforce row limit
    if (employeeData.size > MAX_EXPORT_ROWS) {
      return apiValidationError(`Export exceeds maximum of ${MAX_EXPORT_ROWS} rows. Apply filters to reduce scope.`);
    }

    // Get period label for filename
    const period = scores[0]?.period;
    const periodLabel = period?.label || periodId;

    // Audit the export
    await createAuditEntry({
      action: "export_generated",
      entityType: "performance_data",
      entityId: periodId,
      userId: auth.employeeId || auth.id,
      summary: `${format.toUpperCase()} export of ${employeeData.size} employees for period ${periodLabel}`,
      metadata: {
        format,
        periodId,
        periodLabel,
        employeeId: employeeId || "all",
        recordCount: employeeData.size,
        scope: authz.scope,
        team: authz.scope === "team" ? auth.team : undefined,
      },
    });

    logger.info("Export generated", {
      userId: auth.id,
      format,
      periodId,
      recordCount: employeeData.size,
      scope: authz.scope,
    });

    if (format === "csv") {
      // Watermark header with export metadata
      const watermark = `# Exported by ${auth.name} (${auth.email}) at ${new Date().toISOString()}`;
      const scopeNote = `# Scope: ${authz.scope === "team" ? `Team: ${auth.team}` : "All teams"}`;

      const headers = ["Name", "Role", "Team", "Region", ...categories.map(c => c.replace("_", " ")), "Overall"];
      const rows = Array.from(employeeData.values()).map(emp => {
        const catScores = {} as Record<Category, number>;
        for (const cat of categories) {
          catScores[cat] = emp.scores[cat] ?? 3;
        }
        const overall = computeOverallScore(catScores, config.weights);
        return [emp.name, emp.role, emp.team, emp.region, ...categories.map(c => emp.scores[c]?.toString() ?? "3"), overall.toString()];
      });

      const csv = [watermark, scopeNote, headers.join(","), ...rows.map(r => r.join(","))].join("\n");
      const filename = `performance-${periodLabel}-${new Date().toISOString().slice(0, 10)}.csv`;

      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename=${filename}`,
        },
      });
    }

    // JSON format with metadata
    const result = {
      exportMeta: {
        exportedBy: auth.name,
        exportedAt: new Date().toISOString(),
        scope: authz.scope,
        team: authz.scope === "team" ? auth.team : null,
        period: periodLabel,
        format: "json",
        recordCount: employeeData.size,
      },
      data: Array.from(employeeData.entries()).map(([id, emp]) => {
        const catScores = {} as Record<Category, number>;
        for (const cat of categories) {
          catScores[cat] = emp.scores[cat] ?? 3;
        }
        const overall = computeOverallScore(catScores, config.weights);
        return { id, ...emp, overall };
      }),
    };

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleApiError(error, "export");
  }
}
