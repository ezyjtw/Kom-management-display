import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { apiSuccess, apiValidationError, apiNotFoundError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

/**
 * POST /api/comms/threads/:id/notes
 * Add an internal note to a thread. Uses authenticated session user as author.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const body = await request.json();
    const { content } = body;

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return apiValidationError("content is required");
    }

    const thread = await prisma.commsThread.findUnique({
      where: { id: params.id },
    });

    if (!thread) {
      return apiNotFoundError("Thread");
    }

    const now = new Date();
    const authorId = auth.employeeId || auth.id;

    // Create note with authenticated user as author
    const note = await prisma.threadNote.create({
      data: {
        threadId: params.id,
        authorId,
        content: content.trim(),
      },
      include: {
        author: { select: { id: true, name: true } },
      },
    });

    // Update thread's lastActionAt (adding note counts as activity)
    await prisma.commsThread.update({
      where: { id: params.id },
      data: { lastActionAt: now },
    });

    // Audit: log note creation
    await prisma.auditLog.create({
      data: {
        action: "note_created",
        entityType: "thread",
        entityId: params.id,
        userId: authorId,
        details: JSON.stringify({
          noteId: note.id,
          threadSubject: thread.subject,
        }),
      },
    });

    return apiSuccess(note, undefined, 201);
  } catch (error) {
    return handleApiError(error, "POST /api/comms/threads/[id]/notes");
  }
}
