import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

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

    return apiSuccess(data);
  } catch (error) {
    return handleApiError(error, "projects GET");
  }
}

/**
 * POST /api/projects
 * Create a new project.
 */
export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { name, description, team, leadId, status, priority, startDate, targetDate, tags } = body;

    if (!name || !team || !leadId) {
      return apiValidationError("Missing required fields: name, team, leadId");
    }

    const project = await prisma.$transaction(async (tx) => {
      const proj = await tx.project.create({
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
      await tx.projectMember.create({
        data: {
          projectId: proj.id,
          employeeId: leadId,
          role: "lead",
        },
      });

      await tx.auditLog.create({
        data: {
          action: "project_created",
          entityType: "project",
          entityId: proj.id,
          userId: auth.employeeId || auth.id,
          details: JSON.stringify({ name, team, leadId }),
        },
      });

      return proj;
    });

    return apiSuccess(project, undefined, 201);
  } catch (error) {
    return handleApiError(error, "projects POST");
  }
}
