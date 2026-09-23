/**
 * GET /api/metrics/export?month=YYYY-MM&format=csv|pdf — monthly metrics pack
 * (spec §13.3). Leads and admins only; audit-logged like other exports. PDF
 * uses the existing report renderer (a print-ready HTML document). Team and
 * client level only (H4).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-user";
import { apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { generateReport } from "@/lib/pdf-report";
import { monthPeriod } from "@/modules/metrics/service";
import { buildPack, packRows, toCsv, toHtml } from "@/modules/metrics/export";
import { auditActor } from "@/modules/core-data/audit-actor";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireRole("admin", "lead");
  if (auth instanceof NextResponse) return auth;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.expensive);
  if (limited) return limited;
  try {
    const params = new URL(request.url).searchParams;
    const month = params.get("month") ?? "";
    const format = params.get("format") ?? "csv";
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return apiValidationError("month must be YYYY-MM");
    if (format !== "csv" && format !== "pdf") return apiValidationError("format must be csv or pdf");

    const pack = await buildPack(monthPeriod(month));
    const rows = packRows(pack);
    const actor = auditActor(auth);
    await prisma.auditLog.create({
      data: {
        action: "export",
        entityType: "metrics_monthly",
        entityId: month,
        userId: actor.userId,
        details: JSON.stringify({ ...actor.metadata, format, rowCount: rows.length }),
      },
    });

    if (format === "csv") {
      return new NextResponse(toCsv(rows), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=metrics_${month}.csv` },
      });
    }
    const report = await generateReport("metrics_monthly", { generatedByRole: auth.role, metricsHtml: toHtml(month, pack, rows) });
    return new NextResponse(report.html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename=metrics_${month}.html` },
    });
  } catch (error) {
    return handleApiError(error, "metrics export GET");
  }
}
