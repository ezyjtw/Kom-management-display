import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { apiSuccess, apiValidationError, apiForbiddenError, apiNotFoundError, apiConflictError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

/**
 * GET /api/comms/threads/:id/secondaries
 * Return the list of secondary (collaborator) owners for a thread.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const thread = await prisma.commsThread.findUnique({
      where: { id: params.id },
      select: { secondaryOwnerIds: true },
    });

    if (!thread) {
      return apiNotFoundError("Thread");
    }

    const rawIds = thread.secondaryOwnerIds;
    const ids: string[] = typeof rawIds === "string" ? JSON.parse(rawIds || "[]") : (rawIds as string[] ?? []);

    // Resolve names
    const employees = ids.length
      ? await prisma.employee.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, email: true },
        })
      : [];

    return apiSuccess(employees);
  } catch (error) {
    return handleApiError(error, "GET /api/comms/threads/[id]/secondaries");
  }
}

/**
 * POST /api/comms/threads/:id/secondaries
 * Add or remove a secondary owner.
 *
 * Body: { employeeId: string, action: "add" | "remove" }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const body = await request.json();
    const { employeeId, action } = body;

    if (!employeeId || !["add", "remove"].includes(action)) {
      return apiValidationError("employeeId and action (add|remove) are required");
    }

    const thread = await prisma.commsThread.findUnique({
      where: { id: params.id },
    });

    if (!thread) {
      return apiNotFoundError("Thread");
    }

    // RBAC: owner, secondary owners, and leads/admins can manage secondaries
    const actorId = auth.employeeId || auth.id;
    const isPrivileged = ["admin", "lead"].includes(auth.role);
    const isOwner = thread.ownerUserId === actorId;
    const rawCurrentIds = thread.secondaryOwnerIds;
    const currentIds: string[] = typeof rawCurrentIds === "string" ? JSON.parse(rawCurrentIds || "[]") : (rawCurrentIds as string[] ?? []);
    const isSecondary = currentIds.includes(actorId);

    if (!isPrivileged && !isOwner && !isSecondary) {
      return apiForbiddenError("Only the thread owner, a secondary owner, or a lead/admin can manage collaborators");
    }

    let updatedIds: string[];
    if (action === "add") {
      if (currentIds.includes(employeeId)) {
        return apiConflictError("Employee is already a secondary owner");
      }
      updatedIds = [...currentIds, employeeId];
    } else {
      updatedIds = currentIds.filter((id) => id !== employeeId);
    }

    await prisma.commsThread.update({
      where: { id: params.id },
      data: { secondaryOwnerIds: JSON.stringify(updatedIds) },
    });

    // Audit
    await prisma.auditLog.create({
      data: {
        action: `secondary_owner_${action}`,
        entityType: "thread",
        entityId: params.id,
        userId: actorId,
        details: JSON.stringify({
          employeeId,
          action,
          threadSubject: thread.subject,
        }),
      },
    });

    // Resolve updated list
    const employees = updatedIds.length
      ? await prisma.employee.findMany({
          where: { id: { in: updatedIds } },
          select: { id: true, name: true, email: true },
        })
      : [];

    return apiSuccess(employees);
  } catch (error) {
    return handleApiError(error, "POST /api/comms/threads/[id]/secondaries");
  }
}
