import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const VALID_STATUSES = [
  "Unassigned",
  "Assigned",
  "InProgress",
  "WaitingExternal",
  "WaitingInternal",
  "Done",
  "Closed",
];

/**
 * POST /api/comms/threads/:id/status
 * Change thread status. Updates lastActionAt + TTFA tracking.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { status, userId } = body;

    if (!status || !userId) {
      return NextResponse.json(
        { success: false, error: "status and userId are required" },
        { status: 400 }
      );
    }

    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { success: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
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
    const previousStatus = thread.status;

    // Any status change counts as an "action"
    const updateData: Record<string, unknown> = {
      status,
      lastActionAt: now,
    };

    // If moving to Unassigned, clear owner
    if (status === "Unassigned") {
      updateData.ownerUserId = null;
    }

    const updated = await prisma.commsThread.update({
      where: { id: params.id },
      data: updateData,
      include: {
        owner: { select: { id: true, name: true } },
      },
    });

    // Write audit log
    await prisma.auditLog.create({
      data: {
        action: "status_change",
        entityType: "thread",
        entityId: params.id,
        userId,
        details: JSON.stringify({
          previousStatus,
          newStatus: status,
          threadSubject: thread.subject,
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
