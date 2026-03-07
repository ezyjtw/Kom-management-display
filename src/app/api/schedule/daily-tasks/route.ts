import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";

/**
 * GET /api/schedule/daily-tasks
 * Get daily tasks. Filters: ?date, ?team, ?status, ?assigneeId
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    const team = searchParams.get("team");
    const status = searchParams.get("status");
    const assigneeId = searchParams.get("assigneeId");

    const where: Record<string, unknown> = {};
    if (date) {
      const d = new Date(date);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const end = new Date(start.getTime() + 86400000);
      where.date = { gte: start, lt: end };
    }
    if (team) where.team = team;
    if (status) where.status = status;
    if (assigneeId) where.assigneeId = assigneeId;

    const tasks = await prisma.dailyTask.findMany({
      where,
      include: {
        assignee: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });

    // Map priority for sort: urgent=0, high=1, normal=2, low=3
    const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    const sorted = tasks.sort((a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2));

    const data = sorted.map((t) => ({
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
 * POST /api/schedule/daily-tasks
 * Create a daily task.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { date, team, assigneeId, title, description, priority, category } = body;

    if (!date || !team || !title) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: date, team, title" },
        { status: 400 }
      );
    }

    const validPriorities = ["urgent", "high", "normal", "low"];
    if (priority && !validPriorities.includes(priority)) {
      return NextResponse.json(
        { success: false, error: `Invalid priority. Must be one of: ${validPriorities.join(", ")}` },
        { status: 400 }
      );
    }

    const validCategories = ["operational", "compliance", "client", "administrative"];
    if (category && !validCategories.includes(category)) {
      return NextResponse.json(
        { success: false, error: `Invalid category. Must be one of: ${validCategories.join(", ")}` },
        { status: 400 }
      );
    }

    const createdById = auth.employeeId || auth.id;

    const task = await prisma.dailyTask.create({
      data: {
        date: new Date(date),
        team,
        assigneeId: assigneeId || null,
        title,
        description: description || "",
        priority: priority || "normal",
        category: category || "operational",
        createdById,
      },
      include: {
        assignee: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "daily_task_created",
        entityType: "daily_task",
        entityId: task.id,
        userId: createdById,
        details: JSON.stringify({ date, team, title, assigneeId }),
      },
    });

    return NextResponse.json({ success: true, data: task }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/schedule/daily-tasks
 * Update a task (status, assignee, etc). Body: { id, ...fields }
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { id, status, assigneeId, priority, title, description } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Missing task id" },
        { status: 400 }
      );
    }

    const validStatuses = ["pending", "in_progress", "completed", "skipped"];
    if (status !== undefined && !validStatuses.includes(status)) {
      return NextResponse.json(
        { success: false, error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    const validPriorities = ["urgent", "high", "normal", "low"];
    if (priority !== undefined && !validPriorities.includes(priority)) {
      return NextResponse.json(
        { success: false, error: `Invalid priority. Must be one of: ${validPriorities.join(", ")}` },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (status !== undefined) updateData.status = status;
    if (assigneeId !== undefined) updateData.assigneeId = assigneeId || null;
    if (priority !== undefined) updateData.priority = priority;
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;

    if (status === "completed") {
      updateData.completedAt = new Date();
      updateData.completedById = auth.employeeId || auth.id;
    }

    const task = await prisma.dailyTask.update({
      where: { id },
      data: updateData,
      include: {
        assignee: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ success: true, data: task });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}
