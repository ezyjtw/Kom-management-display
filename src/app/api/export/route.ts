import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-user";
import { checkAuthorization } from "@/modules/auth/services/authorization";
import { exportService } from "@/modules/export/services/export-service";
import { apiValidationError, apiForbiddenError, handleApiError } from "@/lib/api/response";
import type { Role } from "@/modules/auth/types";

/**
 * GET /api/export
 *
 * Export performance data as CSV or JSON.
 * Delegates to exportService which handles permissions, watermarking,
 * sensitivity controls, and audit logging.
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

    const filters: Record<string, unknown> = { periodId };
    if (employeeId) filters.employeeId = employeeId;

    const result = await exportService.exportData(
      {
        resource: "scores",
        format: format as "csv" | "json",
        filters,
      },
      {
        userId: auth.id,
        userRole: auth.role as Role,
        userName: auth.name,
        userTeam: auth.team ?? undefined,
        userEmployeeId: auth.employeeId ?? undefined,
      },
    );

    if (format === "csv") {
      return new NextResponse(result.content, {
        headers: {
          "Content-Type": result.mimeType,
          "Content-Disposition": `attachment; filename=${result.filename}`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      exportMeta: {
        exportedBy: auth.name,
        exportedAt: new Date().toISOString(),
        scope: authz.scope,
        team: authz.scope === "team" ? auth.team : null,
        format: "json",
        recordCount: result.rowCount,
        watermark: result.watermark,
      },
      data: JSON.parse(result.content).data,
    });
  } catch (error) {
    return handleApiError(error, "export");
  }
}
