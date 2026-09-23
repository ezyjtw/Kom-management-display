/**
 * PATCH /api/work-items/:id/priority — leads/admins change priority afterwards
 * (spec §9.4). Audit-logged. Client requests move to the matching SLA policy.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { createAuditEntry } from "@/lib/api/audit";
import { apiNotFoundError, apiSuccess, apiValidationError, apiForbiddenError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { changePrioritySchema, validateBody } from "@/lib/validation";
import { auditActor } from "@/modules/core-data/audit-actor";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "admin" && auth.role !== "lead") return apiForbiddenError("Only leads and admins can change priority");
  const authz = requireAuthorization(auth, "work_item", "update");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const parsed = validateBody(changePrioritySchema, await request.json());
    if (!parsed.success) return apiValidationError(parsed.error);
    const { id } = await params;
    const item = await prisma.workItem.findUnique({ where: { id } });
    if (!item) return apiNotFoundError("Work item");

    const { priority, reason } = parsed.data;
    const sla = item.kind === "client_request"
      ? await prisma.slaPolicy.findUnique({ where: { code: `CLIENT-Q-${priority}` }, select: { id: true } })
      : null;
    const updated = await prisma.workItem.update({
      where: { id },
      data: { priority, ...(sla ? { slaPolicyId: sla.id } : {}) },
    });

    const actor = auditActor(auth);
    await createAuditEntry({
      action: "work_item_priority_changed",
      entityType: "work_item",
      entityId: id,
      userId: actor.userId,
      summary: `Priority ${item.priority} -> ${priority} on ${item.ticketKey ?? id}`,
      before: { priority: item.priority },
      after: { priority },
      metadata: { ...actor.metadata, reason: reason ?? null },
    });
    return apiSuccess(updated);
  } catch (error) {
    return handleApiError(error, "work-item priority");
  }
}
