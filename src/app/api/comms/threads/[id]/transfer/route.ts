import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeTtfaDeadline } from "@/lib/sla";
import type { ThreadPriority } from "@/types";

/**
 * POST /api/comms/threads/:id/transfer
 * Transfer ownership of a thread to another user.
 * Requires handoverNote (strongly encouraged) and reason.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { newOwnerId, changedById, reason, handoverNote } = body;

    if (!changedById) {
      return NextResponse.json(
        { success: false, error: "changedById is required" },
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

    // Update thread
    const updateData: Record<string, unknown> = {
      ownerUserId: newOwnerId || null,
      lastActionAt: now,
    };

    if (newOwnerId) {
      updateData.status = "Assigned";
      updateData.ttfaDeadline = computeTtfaDeadline(now, thread.priority as ThreadPriority);
    } else {
      updateData.status = "Unassigned";
      updateData.ttfaDeadline = null;
    }

    const updated = await prisma.commsThread.update({
      where: { id: params.id },
      data: updateData,
      include: {
        owner: { select: { id: true, name: true } },
      },
    });

    // Log ownership change
    await prisma.ownershipChange.create({
      data: {
        threadId: params.id,
        oldOwnerId: thread.ownerUserId,
        newOwnerId: newOwnerId || null,
        changedById,
        reason: reason || "Transfer",
        handoverNote: handoverNote || "",
      },
    });

    // Create ownership change alert
    await prisma.alert.create({
      data: {
        threadId: params.id,
        type: "ownership_change",
        priority: thread.priority,
        message: `Ownership transferred on "${thread.subject}"${
          handoverNote ? `: ${handoverNote.substring(0, 100)}` : ""
        }`,
        destination: "in_app",
      },
    });

    // Check for excessive bouncing (>2 changes in 24h)
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentChanges = await prisma.ownershipChange.count({
      where: {
        threadId: params.id,
        changedAt: { gte: dayAgo },
      },
    });

    if (recentChanges > 2) {
      await prisma.alert.create({
        data: {
          threadId: params.id,
          type: "ownership_bounce",
          priority: "P1",
          message: `Thread "${thread.subject}" has been reassigned ${recentChanges} times in 24h — investigate`,
          destination: "in_app",
        },
      });
    }

    // Write audit log
    await prisma.auditLog.create({
      data: {
        action: "ownership_change",
        entityType: "thread",
        entityId: params.id,
        userId: changedById,
        details: JSON.stringify({
          action: "transfer",
          previousOwner: thread.ownerUserId,
          newOwner: newOwnerId,
          reason,
          handoverNote,
          bouncingCount: recentChanges,
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
