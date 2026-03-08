import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";

/**
 * GET /api/projects
 * List projects. Filters: ?team, ?status, ?leadId
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const team = searchParams.get("team");
    const status = searchParams.get("status");
    const leadId = searchParams.get("leadId");

    const where: Record<string, unknown> = {};
    if (team) where.team = team;
    if (status) where.status = status;
    if (leadId) where.leadId = leadId;

    const projects = await prisma.project.findMany({
      where,
      include: {
        lead: { select: { id: true, name: true } },
        _count: { select: { members: true, updates: true } },
        updates: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true, createdAt: true },
        },
      },
      orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
    });

    // Sort by priority: critical=0, high=1, medium=2, low=3
    const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const sorted = projects.sort(
      (a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2)
    );

    const data = sorted.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      team: p.team,
      leadId: p.leadId,
      leadName: p.lead.name,
      status: p.status,
      priority: p.priority,
      startDate: p.startDate?.toISOString() || null,
      targetDate: p.targetDate?.toISOString() || null,
      progress: p.progress,
      tags: typeof p.tags === "string" ? JSON.parse(p.tags || "[]") : (p.tags ?? []),
      memberCount: p._count.members,
      latestUpdate: p.updates[0]?.content || null,
      latestUpdateAt: p.updates[0]?.createdAt.toISOString() || null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
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
 * POST /api/projects
 * Create a new project.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { name, description, team, leadId, status, priority, startDate, targetDate, tags } = body;

    if (!name || !team || !leadId) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: name, team, leadId" },
        { status: 400 }
      );
    }

    const project = await prisma.project.create({
      data: {
        name,
        description: description || "",
        team,
        leadId,
        status: status || "active",
        priority: priority || "medium",
        startDate: startDate ? new Date(startDate) : new Date(),
        targetDate: targetDate ? new Date(targetDate) : null,
        tags: JSON.stringify(tags || []),
      },
      include: {
        lead: { select: { id: true, name: true } },
      },
    });

    // Auto-add lead as a member
    await prisma.projectMember.create({
      data: {
        projectId: project.id,
        employeeId: leadId,
        role: "lead",
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "project_created",
        entityType: "project",
        entityId: project.id,
        userId: auth.employeeId || auth.id,
        details: JSON.stringify({ name, team, leadId }),
      },
    });

    return NextResponse.json({ success: true, data: project }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}
