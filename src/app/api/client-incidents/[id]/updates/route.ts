/**
 * POST /api/client-incidents/:id/updates — "Post client update" (spec §9.7).
 * Human-written; posted as a JSM public comment and mirrored internally. For
 * severities that need four-eyes the update waits for a second team member.
 * Text containing internal description or another client is rejected (H12).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { auditedAction } from "@/lib/api/audit";
import { apiSuccess, apiValidationError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/validation";
import { postClientUpdate, updateSchema } from "@/modules/client-incidents/service";
import { clientIncidentError } from "@/modules/client-incidents/http";
import { auditActor } from "@/modules/core-data/audit-actor";
import { workItemScopeGuard } from "@/modules/auth/client-scope";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "update");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;
  try {
    const { id } = await params;
    const outOfScope = await workItemScopeGuard(auth, id);
    if (outOfScope) return outOfScope;
    const parsed = validateBody(updateSchema, await request.json());
    if (!parsed.success) return apiValidationError(parsed.error);
    const actor = auditActor(auth);
    // One action; whether it posted or awaits the second approver (four-eyes, decided by the service) is in the outcome.
    const update = await auditedAction(
      { action: "client_update_submitted", entityType: "work_item", entityId: id, userId: actor.userId, summary: "Submit client update", metadata: actor.metadata },
      async () => postClientUpdate(id, parsed.data, { userId: auth.id, employeeId: auth.employeeId, role: auth.role }),
      (r) => ({ updateId: r?.id ?? null, status: r?.status ?? null }),
    );
    return apiSuccess(update, undefined, 201);
  } catch (error) {
    return clientIncidentError(error, "client update POST");
  }
}
