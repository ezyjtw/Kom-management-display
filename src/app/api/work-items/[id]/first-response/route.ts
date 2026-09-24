/**
 * POST /api/work-items/:id/first-response { body, markSentManually? } — the
 * human-written first reply into the client's Slack thread or email (spec
 * §14.4). Templates allowed, AI not. Checked for other clients' names (H12).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { createAuditEntry } from "@/lib/api/audit";
import { apiSuccess, apiValidationError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/validation";
import { auditActor } from "@/modules/core-data/audit-actor";
import { clientIncidentError } from "@/modules/client-incidents/http";
import { firstResponseSchema, sendFirstResponse } from "@/modules/work-items/first-response";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "update");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;
  try {
    const parsed = validateBody(firstResponseSchema, await request.json().catch(() => ({})));
    if (!parsed.success) return apiValidationError(parsed.error);
    const { id } = await params;
    const result = await sendFirstResponse(id, parsed.data, { userId: auth.id, employeeId: auth.employeeId ?? null, role: auth.role });
    const actor = auditActor(auth);
    await createAuditEntry({
      action: "work_item_first_response_sent", entityType: "work_item", entityId: id, userId: actor.userId,
      summary: `First response ${parsed.data.markSentManually ? "marked as sent manually" : `sent via ${result.sentVia}`}`, metadata: actor.metadata,
    });
    return apiSuccess(result);
  } catch (error) {
    return clientIncidentError(error, "work-item first response");
  }
}
