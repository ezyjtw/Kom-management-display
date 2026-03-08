import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

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

    return apiSuccess(data);
  } catch (error) {
    return handleApiError(error, "project updates GET");
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
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const body = await request.json();
    const { content, type, progress } = body;

    if (!content) {
      return apiValidationError("Missing required field: content");
    }

    const authorId = auth.employeeId || auth.id;

    const update = await prisma.$transaction(async (tx) => {
      const upd = await tx.projectUpdate.create({
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
        await tx.project.update({
          where: { id },
          data: {
            progress,
            ...(progress >= 100 ? { status: "completed", completedAt: new Date() } : {}),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          action: "project_update_added",
          entityType: "project",
          entityId: id,
          userId: authorId,
          details: JSON.stringify({ type: type || "progress", progress }),
        },
      });

      return upd;
    });

    return apiSuccess(update, undefined, 201);
  } catch (error) {
    return handleApiError(error, "project updates POST");
  }
}
