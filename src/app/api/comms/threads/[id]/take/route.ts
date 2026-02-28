import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeTtfaDeadline } from "@/lib/sla";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";
import type { ThreadPriority } from "@/types";

/**
 * POST /api/comms/threads/:id/take
 * Take ownership of a thread. Uses authenticated session user.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const thread = await prisma.commsThread.findUnique({
      where: { id: params.id },
    });

    if (!thread) {
      return NextResponse.json(
        { success: false, error: "Thread not found" },
        { status: 404 }
      );
    }

    if (thread.ownerUserId && auth.role !== "admin") {
      return NextResponse.json(
        { success: false, error: "Thread is already assigned. Use transfer instead." },
        { status: 409 }
      );
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

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}
