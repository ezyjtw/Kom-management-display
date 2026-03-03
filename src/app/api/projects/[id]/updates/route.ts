import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";

/**
 * GET /api/projects/[id]/updates
 * Get all updates for a project.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const updates = await prisma.projectUpdate.findMany({
      where: { projectId: id },
      include: {
        author: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const data = updates.map((u) => ({
      id: u.id,
      authorId: u.authorId,
      authorName: u.author.name,
      content: u.content,
      type: u.type,
      progress: u.progress,
      createdAt: u.createdAt.toISOString(),
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
 * POST /api/projects/[id]/updates
 * Add a progress update to a project.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const body = await request.json();
    const { content, type, progress } = body;

    if (!content) {
      return NextResponse.json(
        { success: false, error: "Missing required field: content" },
        { status: 400 }
      );
    }

    const authorId = auth.employeeId || auth.id;

    const update = await prisma.projectUpdate.create({
      data: {
        projectId: id,
        authorId,
        content,
        type: type || "progress",
        progress: progress !== undefined ? progress : null,
      },
      include: {
        author: { select: { id: true, name: true } },
      },
    });

    // Update project progress if provided
    if (progress !== undefined) {
      await prisma.project.update({
        where: { id },
        data: {
          progress,
          ...(progress >= 100 ? { status: "completed", completedAt: new Date() } : {}),
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        action: "project_update_added",
        entityType: "project",
        entityId: id,
        userId: authorId,
        details: JSON.stringify({ type: type || "progress", progress }),
      },
    });

    return NextResponse.json({ success: true, data: update }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}
