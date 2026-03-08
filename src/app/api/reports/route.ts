import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { generateReport, type ReportType } from "@/lib/pdf-report";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { prisma } from "@/lib/prisma";

const VALID_REPORT_TYPES: ReportType[] = [
  "daily_digest", "weekly_report", "incident_report", "compliance_summary",
];

/**
 * GET /api/reports?type=daily_digest&format=html
 * Generate a report and return it.
 * format=html returns the full HTML document.
 * format=json returns metadata + HTML string.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.expensive);
  if (limited) return limited;

  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") as ReportType;
    const format = searchParams.get("format") || "json";
    const incidentId = searchParams.get("incidentId");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    if (!type || !VALID_REPORT_TYPES.includes(type)) {
      return apiValidationError(`type must be one of: ${VALID_REPORT_TYPES.join(", ")}`);
    }

    const dateRange = startDate && endDate
      ? { start: new Date(startDate), end: new Date(endDate) }
      : undefined;

    const report = await generateReport(type, {
      userId: auth.employeeId || auth.id,
      incidentId: incidentId || undefined,
      dateRange,
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: "report_generated",
        entityType: "report",
        entityId: type,
        userId: auth.employeeId || auth.id,
        details: JSON.stringify({ type, format }),
      },
    });

    // Return as downloadable HTML document
    if (format === "html") {
      return new Response(report.html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `attachment; filename="${report.title.replace(/[^a-zA-Z0-9-_ ]/g, "")}.html"`,
        },
      });
    }

    return apiSuccess(report);
  } catch (error) {
    return handleApiError(error, "reports GET");
  }
}
