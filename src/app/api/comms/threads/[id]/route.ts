import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeSlaStatus, computeTtfaDeadline } from "@/lib/sla";
import { requireAuth } from "@/lib/auth-user";
import { apiSuccess, apiValidationError, apiForbiddenError, apiNotFoundError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
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
      return apiNotFoundError("Thread");
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
    const rawSecondaryIds = thread.secondaryOwnerIds;
    const secondaryIds: string[] = typeof rawSecondaryIds === "string" ? JSON.parse(rawSecondaryIds || "[]") : (rawSecondaryIds as string[] ?? []);
    const secondaryOwners = secondaryIds.length
      ? await prisma.employee.findMany({
          where: { id: { in: secondaryIds } },
          select: { id: true, name: true },
        })
      : [];

    return apiSuccess({ ...thread, slaStatus, secondaryOwners });
  } catch (error) {
    return handleApiError(error, "GET /api/comms/threads/[id]");
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

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
      return apiNotFoundError("Thread");
    }

    const isOwner = thread.ownerUserId === actorEmployeeId;
    const patchRawSecondaryIds = thread.secondaryOwnerIds;
    const secondaryIds: string[] = typeof patchRawSecondaryIds === "string" ? JSON.parse(patchRawSecondaryIds || "[]") : (patchRawSecondaryIds as string[] ?? []);
    const isSecondary = secondaryIds.includes(actorEmployeeId);

    // RBAC: employees can only modify threads they own or collaborate on
    if (!isPrivileged && !isOwner && !isSecondary) {
      return apiForbiddenError("You can only modify threads you own");
    }

    // RBAC: only lead/admin can reassign ownership via PATCH
    // (employees should use /take for self-assignment or /transfer)
    if (ownerUserId !== undefined && !isPrivileged) {
      return apiForbiddenError("Only leads and admins can reassign ownership. Use take or transfer instead.");
    }

    // RBAC: only lead/admin can change priority
    if (priority && priority !== thread.priority && !isPrivileged) {
      return apiForbiddenError("Only leads and admins can change thread priority");
    }

    // RBAC: only lead/admin can change queue
    if (queue && queue !== thread.queue && !isPrivileged) {
      return apiForbiddenError("Only leads and admins can change thread queue");
    }

    // Policy: closing/completing a thread requires a handover note or reason
    if (status && ["Done", "Closed"].includes(status) && !["Done", "Closed"].includes(thread.status)) {
      if (!handoverNote && !body.reason) {
        return apiValidationError("A resolution note is required when closing a thread");
      }
    }

    // Policy: validate priority value
    const VALID_PRIORITIES = ["P0", "P1", "P2", "P3"];
    if (priority && !VALID_PRIORITIES.includes(priority)) {
      return apiValidationError(`Invalid priority. Must be one of: ${VALID_PRIORITIES.join(", ")}`);
    }

    // Policy: validate queue value
    const VALID_QUEUES = ["Admin Operations", "Transaction Operations", "Data Operations"];
    if (queue && !VALID_QUEUES.includes(queue)) {
      return apiValidationError(`Invalid queue. Must be one of: ${VALID_QUEUES.join(", ")}`);
    }

    // Policy: validate linkedRecords is an array if provided
    if (linkedRecords !== undefined && !Array.isArray(linkedRecords)) {
      return apiValidationError("linkedRecords must be an array");
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

    return apiSuccess(updated);
  } catch (error) {
    return handleApiError(error, "PATCH /api/comms/threads/[id]");
  }
}
