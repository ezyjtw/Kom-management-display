import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireRole, safeErrorMessage } from "@/lib/auth-user";

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

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/schedule/on-call
 * Create or update on-call assignment. Admin/lead only.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole("admin", "lead");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { employeeId, date, team, shiftType } = body;

    if (!employeeId || !date || !team) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: employeeId, date, team" },
        { status: 400 }
      );
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
      return NextResponse.json(
        { success: false, error: "Employee has approved PTO on this date" },
        { status: 409 }
      );
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

    return NextResponse.json({ success: true, data: schedule }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}
