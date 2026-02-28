import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeTtfaDeadline } from "@/lib/sla";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";
import type { ThreadPriority } from "@/types";

/**
 * POST /api/comms/threads/:id/transfer
 * Transfer ownership. Only the current owner or admin/lead can transfer.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { newOwnerId, reason, handoverNote } = body;

    const thread = await prisma.commsThread.findUnique({
      where: { id: params.id },
    });

    if (!thread) {
      return NextResponse.json(
        { success: false, error: "Thread not found" },
        { status: 404 }
      );
    }

    // Only owner, admin, or lead can transfer
    const actorId = auth.employeeId || auth.id;
    if (
      thread.ownerUserId !== actorId &&
      !["admin", "lead"].includes(auth.role)
    ) {
      return NextResponse.json(
        { success: false, error: "Only the thread owner or a lead/admin can transfer ownership" },
        { status: 403 }
      );
    }

    const now = new Date();
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

    await prisma.ownershipChange.create({
      data: {
        threadId: params.id,
        oldOwnerId: thread.ownerUserId,
        newOwnerId: newOwnerId || null,
        changedById: auth.id,
        reason: reason || "Transfer",
        handoverNote: handoverNote || "",
      },
    });

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

    // Check for excessive bouncing
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentChanges = await prisma.ownershipChange.count({
      where: { threadId: params.id, changedAt: { gte: dayAgo } },
    });

    if (recentChanges > 2) {
      await prisma.alert.create({
        data: {
          threadId: params.id,
          type: "ownership_bounce",
          priority: "P1",
          message: `Thread "${thread.subject}" has been reassigned ${recentChanges} times in 24h`,
          destination: "in_app",
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        action: "ownership_change",
        entityType: "thread",
        entityId: params.id,
        userId: auth.id,
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
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}
