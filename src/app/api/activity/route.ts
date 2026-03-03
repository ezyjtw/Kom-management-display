import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/activity
 * Get current activity status for all employees (or filtered by team).
 * ?team=Transaction+Operations — filter by team
 * ?history=true&from=...&to=... — get historical time log
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const team = searchParams.get("team");
    const history = searchParams.get("history") === "true";
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    if (history) {
      // Historical time log
      const fromDate = from ? new Date(from) : new Date(new Date().setHours(0, 0, 0, 0));
      const toDate = to ? new Date(to) : new Date();

      const where: Record<string, unknown> = {
        startedAt: { gte: fromDate },
      };
      if (to) {
        where.startedAt = { gte: fromDate, lte: toDate };
      }
      if (team) {
        where.employee = { team };
      }

      const entries = await prisma.activityStatus.findMany({
        where,
        include: {
          employee: { select: { id: true, name: true, team: true, region: true } },
        },
        orderBy: { startedAt: "desc" },
        take: 200,
      });

      return NextResponse.json({
        success: true,
        data: entries.map((e) => ({
          id: e.id,
          employeeId: e.employeeId,
          employeeName: e.employee.name,
          employeeTeam: e.employee.team,
          region: e.employee.region,
          activity: e.activity,
          detail: e.detail,
          startedAt: e.startedAt.toISOString(),
          endedAt: e.endedAt?.toISOString() || null,
          durationMin: e.durationMin,
        })),
      });
    }

    // Current status — get the latest active entry for each employee
    const employeeWhere: Record<string, unknown> = { active: true };
    if (team) employeeWhere.team = team;

    const employees = await prisma.employee.findMany({
      where: employeeWhere,
      select: {
        id: true,
        name: true,
        team: true,
        role: true,
        region: true,
        activityStatuses: {
          where: { endedAt: null },
          orderBy: { startedAt: "desc" },
          take: 1,
        },
      },
      orderBy: [{ team: "asc" }, { name: "asc" }],
    });

    const data = employees.map((e) => {
      const current = e.activityStatuses[0] || null;
      return {
        employeeId: e.id,
        employeeName: e.name,
        team: e.team,
        role: e.role,
        region: e.region,
        currentActivity: current
          ? {
              id: current.id,
              activity: current.activity,
              detail: current.detail,
              startedAt: current.startedAt.toISOString(),
              elapsedMin: Math.floor((Date.now() - current.startedAt.getTime()) / 60000),
            }
          : null,
      };
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Activity GET error:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch activity" }, { status: 500 });
  }
}

/**
 * POST /api/activity
 * Start a new activity (ends any currently active one for the same employee).
 * Body: { employeeId, activity, detail? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { employeeId, activity, detail } = body;

    if (!employeeId || !activity) {
      return NextResponse.json({ success: false, error: "employeeId and activity are required" }, { status: 400 });
    }

    // End any active activity for this employee
    const activeEntries = await prisma.activityStatus.findMany({
      where: { employeeId, endedAt: null },
    });

    const now = new Date();
    for (const entry of activeEntries) {
      const durationMin = Math.floor((now.getTime() - entry.startedAt.getTime()) / 60000);
      await prisma.activityStatus.update({
        where: { id: entry.id },
        data: { endedAt: now, durationMin },
      });
    }

    // Start new activity
    const newStatus = await prisma.activityStatus.create({
      data: {
        employeeId,
        activity,
        detail: detail || "",
      },
      include: {
        employee: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ success: true, data: newStatus }, { status: 201 });
  } catch (error) {
    console.error("Activity POST error:", error);
    return NextResponse.json({ success: false, error: "Failed to start activity" }, { status: 500 });
  }
}

/**
 * PATCH /api/activity
 * End an activity. Body: { id } or { employeeId } (ends all active for that employee)
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, employeeId } = body;

    const now = new Date();

    if (id) {
      const entry = await prisma.activityStatus.findUnique({ where: { id } });
      if (!entry || entry.endedAt) {
        return NextResponse.json({ success: false, error: "Activity not found or already ended" }, { status: 404 });
      }
      const durationMin = Math.floor((now.getTime() - entry.startedAt.getTime()) / 60000);
      const updated = await prisma.activityStatus.update({
        where: { id },
        data: { endedAt: now, durationMin },
      });
      return NextResponse.json({ success: true, data: updated });
    }

    if (employeeId) {
      const active = await prisma.activityStatus.findMany({
        where: { employeeId, endedAt: null },
      });
      for (const entry of active) {
        const durationMin = Math.floor((now.getTime() - entry.startedAt.getTime()) / 60000);
        await prisma.activityStatus.update({
          where: { id: entry.id },
          data: { endedAt: now, durationMin },
        });
      }
      return NextResponse.json({ success: true, data: { ended: active.length } });
    }

    return NextResponse.json({ success: false, error: "id or employeeId required" }, { status: 400 });
  } catch (error) {
    console.error("Activity PATCH error:", error);
    return NextResponse.json({ success: false, error: "Failed to end activity" }, { status: 500 });
  }
}
