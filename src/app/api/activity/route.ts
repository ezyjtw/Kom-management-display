import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiValidationError, apiNotFoundError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

/**
 * GET /api/activity
 *
 * Two modes:
 *   1. Current status (default): returns each employee with their currently active task
 *      (endedAt = null). Used by the live Status Board.
 *   2. Historical time log (?history=true&from=&to=): returns completed activity entries
 *      for the Time Breakdown view.
 *
 * Query params:
 *   ?team=Transaction+Operations — filter employees by team
 *   ?history=true&from=2026-03-03&to=2026-03-04 — return completed entries for date range
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const team = searchParams.get("team");
    const history = searchParams.get("history") === "true";
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    if (history) {
      // Historical mode: fetch completed activity entries for time tracking analysis
      const fromDate = from ? new Date(from) : new Date(new Date().setHours(0, 0, 0, 0));
      const toDate = to ? new Date(to) : new Date();

      const where: Record<string, unknown> = {
        startedAt: { gte: fromDate },
      };
      if (to) {
        where.startedAt = { gte: fromDate, lte: toDate };
      }
      // Filter via nested relation — Prisma resolves the join
      if (team) {
        where.employee = { team };
      }

      const entries = await prisma.activityStatus.findMany({
        where,
        include: {
          employee: { select: { id: true, name: true, team: true, region: true } },
        },
        orderBy: { startedAt: "desc" },
        take: 200, // cap to prevent large payloads
      });

      return apiSuccess(entries.map((e) => ({
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
      })));
    }

    // Current status mode: fetch employees with their latest active (endedAt=null) entry.
    // We query from Employee side so we get ALL employees, even those not checked in.
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
        // Only fetch the single currently-active entry (endedAt is null)
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
              // Compute elapsed time server-side so the client doesn't need to parse timestamps
              elapsedMin: Math.floor((Date.now() - current.startedAt.getTime()) / 60000),
            }
          : null,
      };
    });

    return apiSuccess(data);
  } catch (error) {
    return handleApiError(error, "activity GET");
  }
}

/**
 * POST /api/activity
 *
 * Start a new activity for an employee. Automatically ends any previously
 * active entry for that employee first (each person can only have one
 * current activity at a time). Duration is computed when an activity ends.
 *
 * Body: { employeeId, activity, detail? }
 * activity: one of project|bau|queue_monitoring|lunch|break|meeting|admin|training
 */
export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const body = await request.json();
    const { employeeId, activity, detail } = body;

    if (!employeeId || !activity) {
      return apiValidationError("employeeId and activity are required");
    }

    // End any currently-active activity for this employee before starting a new one.
    // This enforces the one-activity-at-a-time constraint.
    const activeEntries = await prisma.activityStatus.findMany({
      where: { employeeId, endedAt: null },
    });

    const now = new Date();
    for (const entry of activeEntries) {
      // Compute duration at close time rather than relying on a cron job
      const durationMin = Math.floor((now.getTime() - entry.startedAt.getTime()) / 60000);
      await prisma.activityStatus.update({
        where: { id: entry.id },
        data: { endedAt: now, durationMin },
      });
    }

    // Start the new activity (endedAt defaults to null = currently active)
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

    return apiSuccess(newStatus, undefined, 201);
  } catch (error) {
    return handleApiError(error, "activity POST");
  }
}

/**
 * PATCH /api/activity
 *
 * End an activity without starting a new one (e.g. employee clocking off).
 * Two modes:
 *   { id } — end a specific activity entry
 *   { employeeId } — end all active entries for that employee
 */
export async function PATCH(request: NextRequest) {
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const body = await request.json();
    const { id, employeeId } = body;

    const now = new Date();

    // Mode 1: End a specific activity by ID
    if (id) {
      const entry = await prisma.activityStatus.findUnique({ where: { id } });
      if (!entry || entry.endedAt) {
        return apiNotFoundError("Activity not found or already ended");
      }
      const durationMin = Math.floor((now.getTime() - entry.startedAt.getTime()) / 60000);
      const updated = await prisma.activityStatus.update({
        where: { id },
        data: { endedAt: now, durationMin },
      });
      return apiSuccess(updated);
    }

    // Mode 2: End all active entries for an employee (used by "End" button on the board)
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
      return apiSuccess({ ended: active.length });
    }

    return apiValidationError("id or employeeId required");
  } catch (error) {
    return handleApiError(error, "activity PATCH");
  }
}
