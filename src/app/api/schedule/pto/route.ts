import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireRole } from "@/lib/auth-user";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

/**
 * GET /api/schedule/pto
 * Get PTO records. Filters: ?employeeId, ?from, ?to, ?status
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get("employeeId");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const status = searchParams.get("status");

    const where: Record<string, unknown> = {};
    if (employeeId) where.employeeId = employeeId;
    if (status) where.status = status;
    if (from) where.endDate = { gte: new Date(from) };
    if (to) {
      where.startDate = { ...(where.startDate as Record<string, unknown> || {}), lte: new Date(to) };
    }

    const records = await prisma.ptoRecord.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, team: true } },
      },
      orderBy: { startDate: "asc" },
    });

    const data = records.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: r.employee.name,
      employeeTeam: r.employee.team,
      startDate: r.startDate.toISOString(),
      endDate: r.endDate.toISOString(),
      type: r.type,
      status: r.status,
      notes: r.notes,
    }));

    return apiSuccess(data);
  } catch (error) {
    return handleApiError(error, "pto GET");
  }
}

/**
 * POST /api/schedule/pto
 * Create a PTO record. Admin/lead can create for any employee.
 */
export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  const auth = await requireRole("admin", "lead");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { employeeId, startDate, endDate, type, status, notes } = body;

    if (!employeeId || !startDate || !endDate) {
      return apiValidationError("Missing required fields: employeeId, startDate, endDate");
    }

    const validTypes = ["annual_leave", "sick", "wfh", "other"];
    if (type && !validTypes.includes(type)) {
      return apiValidationError(`Invalid type. Must be one of: ${validTypes.join(", ")}`);
    }

    const validStatuses = ["pending", "approved", "rejected"];
    if (status && !validStatuses.includes(status)) {
      return apiValidationError(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
    }

    const record = await prisma.ptoRecord.create({
      data: {
        employeeId,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        type: type || "annual_leave",
        status: status || "approved",
        notes: notes || "",
      },
      include: {
        employee: { select: { id: true, name: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "pto_created",
        entityType: "pto_record",
        entityId: record.id,
        userId: auth.employeeId || auth.id,
        details: JSON.stringify({ employeeId, startDate, endDate, type }),
      },
    });

    return apiSuccess(record, undefined, 201);
  } catch (error) {
    return handleApiError(error, "pto POST");
  }
}
