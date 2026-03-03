import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";

/**
 * GET /api/schedule/daily-tasks/summary
 * Get daily task summary per team for a given date. ?date (defaults to today)
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const dateStr = searchParams.get("date");
    const d = dateStr ? new Date(dateStr) : new Date();
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end = new Date(start.getTime() + 86400000);

    const teams = ["Transaction Operations", "Admin Operations", "Data Operations"];

    // Get team leads
    const leads = await prisma.employee.findMany({
      where: { role: "Lead", active: true },
      select: { id: true, name: true, team: true },
    });

    const leadMap = new Map(leads.map((l) => [l.team, l.name]));

    // Get tasks for today grouped by team
    const tasks = await prisma.dailyTask.findMany({
      where: { date: { gte: start, lt: end } },
      include: {
        assignee: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    // Get on-call info for today
    const onCall = await prisma.onCallSchedule.findMany({
      where: { date: { gte: start, lt: end } },
      include: {
        employee: { select: { id: true, name: true } },
      },
    });

    // Get PTO for today
    const pto = await prisma.ptoRecord.findMany({
      where: {
        status: "approved",
        startDate: { lte: end },
        endDate: { gte: start },
      },
      include: {
        employee: { select: { id: true, name: true, team: true } },
      },
    });

    // Get holidays for today
    const holidays = await prisma.publicHoliday.findMany({
      where: { date: { gte: start, lt: end } },
    });

    const summary = teams.map((team) => {
      const teamTasks = tasks.filter((t) => t.team === team);
      const teamOnCall = onCall.filter((o) => o.team === team);
      const teamPto = pto.filter((p) => p.employee.team === team);

      return {
        team,
        teamLead: leadMap.get(team) || "Unassigned",
        totalTasks: teamTasks.length,
        completedTasks: teamTasks.filter((t) => t.status === "completed").length,
        pendingTasks: teamTasks.filter((t) => t.status === "pending").length,
        inProgressTasks: teamTasks.filter((t) => t.status === "in_progress").length,
        onCall: teamOnCall.map((o) => ({
          employeeName: o.employee.name,
          shiftType: o.shiftType,
        })),
        ptoToday: teamPto.map((p) => ({
          employeeName: p.employee.name,
          type: p.type,
        })),
        tasks: teamTasks.map((t) => ({
          id: t.id,
          date: t.date.toISOString(),
          team: t.team,
          assigneeId: t.assigneeId,
          assigneeName: t.assignee?.name || null,
          title: t.title,
          description: t.description,
          priority: t.priority,
          status: t.status,
          category: t.category,
          completedAt: t.completedAt?.toISOString() || null,
          createdById: t.createdById,
          createdByName: t.createdBy.name,
        })),
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        date: start.toISOString(),
        holidays: holidays.map((h) => ({ name: h.name, region: h.region })),
        teams: summary,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}
