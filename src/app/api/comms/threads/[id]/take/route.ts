import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeTtfaDeadline } from "@/lib/sla";
import { requireAuth } from "@/lib/auth-user";
import { apiSuccess, apiNotFoundError, apiConflictError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import type { ThreadPriority } from "@/types";

/**
 * POST /api/comms/threads/:id/take
 * Take ownership of a thread. Uses authenticated session user.
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
    const thread = await prisma.commsThread.findUnique({
      where: { id: params.id },
    });

    if (!thread) {
      return apiNotFoundError("Thread");
    }

    if (thread.ownerUserId && auth.role !== "admin") {
      return apiConflictError("Thread is already assigned. Use transfer instead.");
    }

    const now = new Date();
    const userId = auth.employeeId || auth.id;

    const updated = await prisma.commsThread.update({
      where: { id: params.id },
      data: {
        ownerUserId: userId,
        status: thread.status === "Unassigned" ? "Assigned" : thread.status,
        lastActionAt: now,
        ttfaDeadline: computeTtfaDeadline(now, thread.priority as ThreadPriority),
      },
      include: {
        owner: { select: { id: true, name: true } },
      },
    });

    await prisma.ownershipChange.create({
      data: {
        threadId: params.id,
        oldOwnerId: thread.ownerUserId,
        newOwnerId: userId,
        changedById: auth.id,
        reason: "Took ownership",
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "ownership_change",
        entityType: "thread",
        entityId: params.id,
        userId: auth.id,
        details: JSON.stringify({
          action: "take",
          previousOwner: thread.ownerUserId,
          newOwner: userId,
        }),
      },
    });

    return apiSuccess(updated);
  } catch (error) {
    return handleApiError(error, "POST /api/comms/threads/[id]/take");
  }
}
