import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";

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
 * Change thread status. Only the thread owner or lead/admin can change status.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { status } = body;

    if (!status) {
      return NextResponse.json(
        { success: false, error: "status is required" },
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

    // RBAC: only thread owner or lead/admin can change status
    const actorEmployeeId = auth.employeeId || auth.id;
    const isOwner = thread.ownerUserId === actorEmployeeId;
    const isPrivileged = ["admin", "lead"].includes(auth.role);

    if (!isOwner && !isPrivileged) {
      return NextResponse.json(
        { success: false, error: "Only the thread owner or a lead/admin can change status" },
        { status: 403 }
      );
    }

    const now = new Date();
    const previousStatus = thread.status;

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

    await prisma.auditLog.create({
      data: {
        action: "status_change",
        entityType: "thread",
        entityId: params.id,
        userId: auth.id,
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
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}
