import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeSlaStatus, computeTtfaDeadline } from "@/lib/sla";
import type { ThreadPriority } from "@/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const thread = await prisma.commsThread.findUnique({
      where: { id: params.id },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        messages: {
          orderBy: { timestamp: "asc" },
        },
        ownershipChanges: {
          include: {
            oldOwner: { select: { id: true, name: true } },
            newOwner: { select: { id: true, name: true } },
            changedBy: { select: { id: true, name: true } },
          },
          orderBy: { changedAt: "desc" },
        },
        notes: {
          include: {
            author: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        alerts: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
    });

    if (!thread) {
      return NextResponse.json(
        { success: false, error: "Thread not found" },
        { status: 404 }
      );
    }

    const slaStatus = computeSlaStatus({
      createdAt: thread.createdAt,
      ownerUserId: thread.ownerUserId,
      lastActionAt: thread.lastActionAt,
      status: thread.status,
      priority: thread.priority,
      ttoDeadline: thread.ttoDeadline,
      ttfaDeadline: thread.ttfaDeadline,
      tslaDeadline: thread.tslaDeadline,
    });

    return NextResponse.json({
      success: true,
      data: { ...thread, slaStatus },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { status, ownerUserId, priority, queue, linkedRecords, actionBy, handoverNote } = body;

    const thread = await prisma.commsThread.findUnique({
      where: { id: params.id },
    });

    if (!thread) {
      return NextResponse.json(
        { success: false, error: "Thread not found" },
        { status: 404 }
      );
    }

    const data: Record<string, unknown> = {};
    const now = new Date();

    // Handle ownership change
    if (ownerUserId !== undefined && ownerUserId !== thread.ownerUserId) {
      data.ownerUserId = ownerUserId || null;
      data.lastActionAt = now;

      // Log ownership change
      if (actionBy) {
        await prisma.ownershipChange.create({
          data: {
            threadId: params.id,
            oldOwnerId: thread.ownerUserId,
            newOwnerId: ownerUserId || null,
            changedById: actionBy,
            reason: body.reason || "",
            handoverNote: handoverNote || "",
          },
        });

        // Create alert for ownership change
        await prisma.alert.create({
          data: {
            threadId: params.id,
            type: "ownership_change",
            priority: thread.priority,
            message: `Ownership changed on: ${thread.subject}`,
            destination: "in_app",
          },
        });
      }

      // Set TTFA deadline when owner assigned
      if (ownerUserId) {
        data.ttfaDeadline = computeTtfaDeadline(now, thread.priority as ThreadPriority);
        if (thread.status === "Unassigned") {
          data.status = "Assigned";
        }
      }
    }

    // Handle status change
    if (status && status !== thread.status) {
      data.status = status;
      data.lastActionAt = now;
    }

    if (priority) data.priority = priority;
    if (queue) data.queue = queue;
    if (linkedRecords) data.linkedRecords = JSON.stringify(linkedRecords);

    const updated = await prisma.commsThread.update({
      where: { id: params.id },
      data,
      include: {
        owner: { select: { id: true, name: true } },
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
