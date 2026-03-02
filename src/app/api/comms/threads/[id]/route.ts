import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeSlaStatus, computeTtfaDeadline } from "@/lib/sla";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";
import type { ThreadPriority } from "@/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

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

    // Resolve secondary owner names
    const secondaryIds: string[] = JSON.parse(thread.secondaryOwnerIds || "[]");
    const secondaryOwners = secondaryIds.length
      ? await prisma.employee.findMany({
          where: { id: { in: secondaryIds } },
          select: { id: true, name: true },
        })
      : [];

    return NextResponse.json({
      success: true,
      data: { ...thread, slaStatus, secondaryOwners },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { status, ownerUserId, priority, queue, linkedRecords, handoverNote } = body;

    const actorId = auth.id;
    const actorEmployeeId = auth.employeeId || auth.id;
    const isPrivileged = ["admin", "lead"].includes(auth.role);

    const thread = await prisma.commsThread.findUnique({
      where: { id: params.id },
    });

    if (!thread) {
      return NextResponse.json(
        { success: false, error: "Thread not found" },
        { status: 404 }
      );
    }

    const isOwner = thread.ownerUserId === actorEmployeeId;
    const secondaryIds: string[] = JSON.parse(thread.secondaryOwnerIds || "[]");
    const isSecondary = secondaryIds.includes(actorEmployeeId);

    // RBAC: employees can only modify threads they own or collaborate on
    if (!isPrivileged && !isOwner && !isSecondary) {
      return NextResponse.json(
        { success: false, error: "You can only modify threads you own" },
        { status: 403 }
      );
    }

    // RBAC: only lead/admin can reassign ownership via PATCH
    // (employees should use /take for self-assignment or /transfer)
    if (ownerUserId !== undefined && !isPrivileged) {
      return NextResponse.json(
        { success: false, error: "Only leads and admins can reassign ownership. Use take or transfer instead." },
        { status: 403 }
      );
    }

    // RBAC: only lead/admin can change priority
    if (priority && priority !== thread.priority && !isPrivileged) {
      return NextResponse.json(
        { success: false, error: "Only leads and admins can change thread priority" },
        { status: 403 }
      );
    }

    // RBAC: only lead/admin can change queue
    if (queue && queue !== thread.queue && !isPrivileged) {
      return NextResponse.json(
        { success: false, error: "Only leads and admins can change thread queue" },
        { status: 403 }
      );
    }

    // Policy: closing/completing a thread requires a handover note or reason
    if (status && ["Done", "Closed"].includes(status) && !["Done", "Closed"].includes(thread.status)) {
      if (!handoverNote && !body.reason) {
        return NextResponse.json(
          { success: false, error: "A resolution note is required when closing a thread" },
          { status: 400 }
        );
      }
    }

    // Policy: validate priority value
    const VALID_PRIORITIES = ["P0", "P1", "P2", "P3"];
    if (priority && !VALID_PRIORITIES.includes(priority)) {
      return NextResponse.json(
        { success: false, error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(", ")}` },
        { status: 400 }
      );
    }

    // Policy: validate queue value
    const VALID_QUEUES = ["Ops", "Settlements", "StakingOps"];
    if (queue && !VALID_QUEUES.includes(queue)) {
      return NextResponse.json(
        { success: false, error: `Invalid queue. Must be one of: ${VALID_QUEUES.join(", ")}` },
        { status: 400 }
      );
    }

    // Policy: validate linkedRecords is an array if provided
    if (linkedRecords !== undefined && !Array.isArray(linkedRecords)) {
      return NextResponse.json(
        { success: false, error: "linkedRecords must be an array" },
        { status: 400 }
      );
    }

    const data: Record<string, unknown> = {};
    const now = new Date();
    const auditDetails: Record<string, unknown> = {};

    // Handle ownership change (lead/admin only, enforced above)
    if (ownerUserId !== undefined && ownerUserId !== thread.ownerUserId) {
      data.ownerUserId = ownerUserId || null;
      data.lastActionAt = now;

      auditDetails.ownershipChange = {
        previousOwner: thread.ownerUserId,
        newOwner: ownerUserId || null,
        handoverNote: handoverNote || null,
      };

      await prisma.ownershipChange.create({
        data: {
          threadId: params.id,
          oldOwnerId: thread.ownerUserId,
          newOwnerId: ownerUserId || null,
          changedById: actorId,
          reason: body.reason || "",
          handoverNote: handoverNote || "",
        },
      });

      await prisma.alert.create({
        data: {
          threadId: params.id,
          type: "ownership_change",
          priority: thread.priority,
          message: `Ownership changed on: ${thread.subject}`,
          destination: "in_app",
        },
      });

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
      auditDetails.statusChange = {
        previousStatus: thread.status,
        newStatus: status,
      };
      data.status = status;
      data.lastActionAt = now;
    }

    if (priority && priority !== thread.priority) {
      auditDetails.priorityChange = { previous: thread.priority, new: priority };
      data.priority = priority;
    }
    if (queue && queue !== thread.queue) {
      auditDetails.queueChange = { previous: thread.queue, new: queue };
      data.queue = queue;
    }
    if (linkedRecords) data.linkedRecords = JSON.stringify(linkedRecords);

    const updated = await prisma.commsThread.update({
      where: { id: params.id },
      data,
      include: {
        owner: { select: { id: true, name: true } },
      },
    });

    // Write audit log for all changes
    if (Object.keys(auditDetails).length > 0) {
      const actions = Object.keys(auditDetails);
      await prisma.auditLog.create({
        data: {
          action: actions.includes("ownershipChange") ? "ownership_change" : actions.includes("statusChange") ? "status_change" : "thread_update",
          entityType: "thread",
          entityId: params.id,
          userId: actorId,
          details: JSON.stringify({
            threadSubject: thread.subject,
            ...auditDetails,
          }),
        },
      });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}
