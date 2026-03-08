import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireRole } from "@/lib/auth-user";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

/**
 * GET /api/schedule/rota
 * Get rota assignments. Filters: ?from, ?to, ?team (parentTeam), ?subTeamId
 * Returns sub-teams with their current assignments including employee, shift, location info.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const team = searchParams.get("team");
    const subTeamId = searchParams.get("subTeamId");

    // Get sub-teams
    const subTeamWhere: Record<string, unknown> = { active: true };
    if (team) subTeamWhere.parentTeam = team;
    if (subTeamId) subTeamWhere.id = subTeamId;

    const subTeams = await prisma.subTeam.findMany({
      where: subTeamWhere,
      orderBy: { sortOrder: "asc" },
    });

    // Get assignments for the date range
    const assignmentWhere: Record<string, unknown> = {};
    if (subTeamId) {
      assignmentWhere.subTeamId = subTeamId;
    } else {
      assignmentWhere.subTeamId = { in: subTeams.map((s) => s.id) };
    }
    if (from) assignmentWhere.endDate = { gte: new Date(from) };
    if (to) {
      assignmentWhere.startDate = { ...(assignmentWhere.startDate as Record<string, unknown> || {}), lte: new Date(to) };
    }

    const assignments = await prisma.rotaAssignment.findMany({
      where: assignmentWhere,
      include: {
        employee: { select: { id: true, name: true, role: true, team: true, region: true } },
        subTeam: { select: { id: true, name: true, parentTeam: true } },
      },
      orderBy: [{ startDate: "asc" }, { role: "asc" }],
    });

    // Get PTO that overlaps with the date range for awareness
    let ptoList: Array<{ employeeId: string; employeeName: string; startDate: Date; endDate: Date; type: string }> = [];
    if (from && to) {
      const ptoRecords = await prisma.ptoRecord.findMany({
        where: {
          status: "approved",
          startDate: { lte: new Date(to) },
          endDate: { gte: new Date(from) },
        },
        include: { employee: { select: { id: true, name: true } } },
      });
      ptoList = ptoRecords.map((p) => ({
        employeeId: p.employeeId,
        employeeName: p.employee.name,
        startDate: p.startDate,
        endDate: p.endDate,
        type: p.type,
      }));
    }

    // Get holidays in range
    let holidays: Array<{ date: string; name: string; region: string }> = [];
    if (from && to) {
      const hols = await prisma.publicHoliday.findMany({
        where: {
          date: { gte: new Date(from), lte: new Date(to) },
        },
        orderBy: { date: "asc" },
      });
      holidays = hols.map((h) => ({ date: h.date.toISOString(), name: h.name, region: h.region }));
    }

    // Group assignments by sub-team and period
    const data = subTeams.map((st) => {
      const teamAssignments = assignments.filter((a) => a.subTeamId === st.id);

      // Group by start date to show rotation periods
      const periods = new Map<string, typeof teamAssignments>();
      for (const a of teamAssignments) {
        const key = a.startDate.toISOString();
        if (!periods.has(key)) periods.set(key, []);
        periods.get(key)!.push(a);
      }

      return {
        subTeam: {
          id: st.id,
          name: st.name,
          parentTeam: st.parentTeam,
          description: st.description,
        },
        periods: Array.from(periods.entries()).map(([startDate, periodAssignments]) => {
          const lead = periodAssignments.find((a) => a.role === "lead");
          const members = periodAssignments.filter((a) => a.role === "member");

          return {
            startDate,
            endDate: periodAssignments[0]?.endDate.toISOString(),
            rotationCycle: lead?.rotationCycle || "weekly",
            lead: lead ? {
              id: lead.id,
              employeeId: lead.employeeId,
              employeeName: lead.employee.name,
              location: lead.location,
              shiftType: lead.shiftType,
              isWfh: lead.isWfh,
              hasPto: ptoList.some((p) => p.employeeId === lead.employeeId && p.startDate <= new Date(startDate) && p.endDate >= new Date(startDate)),
            } : null,
            members: members.map((m) => ({
              id: m.id,
              employeeId: m.employeeId,
              employeeName: m.employee.name,
              location: m.location,
              shiftType: m.shiftType,
              isWfh: m.isWfh,
              hasPto: ptoList.some((p) => p.employeeId === m.employeeId && p.startDate <= m.startDate && p.endDate >= m.startDate),
            })),
          };
        }),
      };
    });

    return apiSuccess({
      subTeams: data,
      holidays,
      pto: ptoList.map((p) => ({
        employeeId: p.employeeId,
        employeeName: p.employeeName,
        startDate: p.startDate.toISOString(),
        endDate: p.endDate.toISOString(),
        type: p.type,
      })),
    });
  } catch (error) {
    return handleApiError(error, "rota GET");
  }
}

/**
 * POST /api/schedule/rota
 * Create/update a rota assignment. Admin/lead only.
 */
export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  const auth = await requireRole("admin", "lead");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { subTeamId, employeeId, role, startDate, endDate, rotationCycle, shiftType, isWfh, location } = body;

    if (!subTeamId || !employeeId || !startDate || !endDate) {
      return apiValidationError("Missing required fields: subTeamId, employeeId, startDate, endDate");
    }

    const assignment = await prisma.rotaAssignment.upsert({
      where: {
        subTeamId_employeeId_startDate: {
          subTeamId,
          employeeId,
          startDate: new Date(startDate),
        },
      },
      update: {
        role: role || "member",
        endDate: new Date(endDate),
        rotationCycle: rotationCycle || "weekly",
        shiftType: shiftType || "standard",
        isWfh: isWfh || false,
        location: location || "London",
      },
      create: {
        subTeamId,
        employeeId,
        role: role || "member",
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        rotationCycle: rotationCycle || "weekly",
        shiftType: shiftType || "standard",
        isWfh: isWfh || false,
        location: location || "London",
      },
      include: {
        employee: { select: { id: true, name: true } },
        subTeam: { select: { id: true, name: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "rota_assigned",
        entityType: "rota_assignment",
        entityId: assignment.id,
        userId: auth.employeeId || auth.id,
        details: JSON.stringify({ subTeamId, employeeId, role, startDate, shiftType, location }),
      },
    });

    return apiSuccess(assignment, undefined, 201);
  } catch (error) {
    return handleApiError(error, "rota POST");
  }
}
