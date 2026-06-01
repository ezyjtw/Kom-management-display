import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, apiValidationError, apiForbiddenError, apiConflictError, apiNotFoundError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody, updateThreadStatusSchema } from "@/lib/validation";

const VALID_STATUSES = [
  "Unassigned",
  "Assigned",
  "InProgress",
  "WaitingExternal",
  "WaitingInternal",
  "Done",
  "Closed",
];

const THREAD_TRANSITIONS: Record<string, string[]> = {
  Unassigned: ["Assigned"],
  Assigned: ["InProgress", "WaitingExternal", "WaitingInternal", "Unassigned"],
  InProgress: ["WaitingExternal", "WaitingInternal", "PendingHandover", "Done", "Closed"],
  WaitingExternal: ["InProgress", "Done", "Closed"],
  WaitingInternal: ["InProgress", "Done", "Closed"],
  PendingHandover: ["Assigned", "InProgress"],
  Done: ["Closed"],
  Closed: [],
};

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

  const authz = requireAuthorization(auth, "thread", "update");
  if (authz instanceof NextResponse) return authz;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const body = await request.json();
    const parsed = validateBody(updateThreadStatusSchema, body);
    if (!parsed.success) return apiValidationError(parsed.error);
    const { status, reason } = parsed.data;

    if (!VALID_STATUSES.includes(status)) {
      return apiValidationError(`Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`);
    }

    const thread = await prisma.commsThread.findUnique({
      where: { id: params.id },
    });

    if (!thread) {
      return apiNotFoundError("Thread");
    }

    // RBAC: only thread owner or lead/admin can change status
    const actorEmployeeId = auth.employeeId || auth.id;
    const isOwner = thread.ownerUserId === actorEmployeeId;
    const isPrivileged = ["admin", "lead"].includes(auth.role);

    if (!isOwner && !isPrivileged) {
      return apiForbiddenError("Only the thread owner or a lead/admin can change status");
    }

    // State machine: validate transition (admins can force-transition from terminal states)
    const allowed = THREAD_TRANSITIONS[thread.status] ?? [];
    if (!allowed.includes(status)) {
      if (isPrivileged && ["Done", "Closed"].includes(thread.status)) {
        // Admins/leads can reopen: allow transition to InProgress
        if (status !== "InProgress") {
          return apiConflictError(
            `Cannot transition from "${thread.status}" to "${status}". Admins can only reopen to "InProgress".`
          );
        }
      } else {
        return apiConflictError(
          `Cannot transition from "${thread.status}" to "${status}". ` +
          `Allowed: ${allowed.length ? allowed.join(", ") : "none (thread is terminal)"}.`
        );
      }
    }

    // Policy: closing requires a resolution note
    if (["Done", "Closed"].includes(status) && !["Done", "Closed"].includes(thread.status)) {
      if (!reason) {
        return apiValidationError("A resolution note is required when closing a thread");
      }
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
          ...(reason ? { resolutionNote: reason } : {}),
        }),
      },
    });

    return apiSuccess(updated);
  } catch (error) {
    return handleApiError(error, "POST /api/comms/threads/[id]/status");
  }
}
