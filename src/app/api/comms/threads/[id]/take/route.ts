import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeTtfaDeadline } from "@/lib/sla";
import type { ThreadPriority } from "@/types";

/**
 * POST /api/comms/threads/:id/take
 * Take ownership of an unassigned thread.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { success: false, error: "userId is required" },
        { status: 400 }
      );
    }

    const thread = await prisma.commsThread.findUnique({
      where: { id: params.id },
    });

    if (!thread) {
      return NextResponse.json(
        { success: false, error: "Thread not found" },
        { status: 404 }
      );
    }

    const now = new Date();

    // Update thread with new owner
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

    // Log ownership change
    await prisma.ownershipChange.create({
      data: {
        threadId: params.id,
        oldOwnerId: thread.ownerUserId,
        newOwnerId: userId,
        changedById: userId,
        reason: "Took ownership",
      },
    });

    // Write audit log
    await prisma.auditLog.create({
      data: {
        action: "ownership_change",
        entityType: "thread",
        entityId: params.id,
        userId,
        details: JSON.stringify({
          action: "take",
          previousOwner: thread.ownerUserId,
          newOwner: userId,
          previousStatus: thread.status,
          newStatus: updated.status,
        }),
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
