import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireRole } from "@/lib/auth-user";
import { apiSuccess, apiValidationError, apiConflictError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

/**
 * GET /api/schedule/on-call
 * Get on-call schedule. Filters: ?team, ?from (date), ?to (date)
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const team = searchParams.get("team");
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const where: Record<string, unknown> = {};
    if (team) where.team = team;
    if (from || to) {
      where.date = {};
      if (from) (where.date as Record<string, unknown>).gte = new Date(from);
      if (to) (where.date as Record<string, unknown>).lte = new Date(to);
    }

    const schedules = await prisma.onCallSchedule.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, team: true, region: true } },
      },
      orderBy: [{ date: "asc" }, { team: "asc" }],
    });

    // Enrich with PTO and holiday info for the date range
    const data = schedules.map((s) => ({
      id: s.id,
      employeeId: s.employeeId,
      employeeName: s.employee.name,
      employeeTeam: s.employee.team,
      employeeRegion: s.employee.region,
      date: s.date.toISOString(),
      team: s.team,
      shiftType: s.shiftType,
    }));

    return apiSuccess(data);
  } catch (error) {
    return handleApiError(error, "on-call GET");
  }
}

/**
 * POST /api/schedule/on-call
 * Create or update on-call assignment. Admin/lead only.
 */
export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  const auth = await requireRole("admin", "lead");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { employeeId, date, team, shiftType } = body;

    if (!employeeId || !date || !team) {
      return apiValidationError("Missing required fields: employeeId, date, team");
    }

    // Check if employee has PTO on that date
    const ptoConflict = await prisma.ptoRecord.findFirst({
      where: {
        employeeId,
        status: "approved",
        startDate: { lte: new Date(date) },
        endDate: { gte: new Date(date) },
      },
    });

    if (ptoConflict) {
      return apiConflictError("Employee has approved PTO on this date");
    }

    const schedule = await prisma.onCallSchedule.upsert({
      where: {
        date_team_shiftType: {
          date: new Date(date),
          team,
          shiftType: shiftType || "primary",
        },
      },
      update: { employeeId },
      create: {
        employeeId,
        date: new Date(date),
        team,
        shiftType: shiftType || "primary",
      },
      include: {
        employee: { select: { id: true, name: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "on_call_assigned",
        entityType: "on_call_schedule",
        entityId: schedule.id,
        userId: auth.employeeId || auth.id,
        details: JSON.stringify({ employeeId, date, team, shiftType }),
      },
    });

    return apiSuccess(schedule, undefined, 201);
  } catch (error) {
    return handleApiError(error, "on-call POST");
  }
}
