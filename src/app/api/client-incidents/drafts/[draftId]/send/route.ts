/**
 * POST /api/client-incidents/drafts/:draftId/send — the operator sends a drafted
 * client message (Slack thread reply or email reply) after editing it. Nothing
 * is sent without this explicit action (spec §9.7, H12). With
 * markSentManually, records that the operator sent it themselves (e.g. from Outlook).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { createAuditEntry } from "@/lib/api/audit";
import { apiSuccess, apiValidationError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/validation";
import { sendDraft } from "@/modules/client-incidents/service";
import { clientIncidentError } from "@/modules/client-incidents/http";
import { auditActor } from "@/modules/core-data/audit-actor";

const bodySchema = z.object({ body: z.string().min(1).max(4000), markSentManually: z.boolean().optional() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ draftId: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "update");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;
  try {
    const { draftId } = await params;
    const parsed = validateBody(bodySchema, await request.json());
    if (!parsed.success) return apiValidationError(parsed.error);
    const sent = await sendDraft(draftId, parsed.data.body, { userId: auth.id, employeeId: auth.employeeId, role: auth.role }, { markSentManually: parsed.data.markSentManually });
    const actor = auditActor(auth);
    await createAuditEntry({ action: "client_message_sent", entityType: "work_item", entityId: sent.workItemId, userId: actor.userId, summary: `Client message sent (${sent.channel}${parsed.data.markSentManually ? ", marked sent manually" : ""})`, metadata: actor.metadata });
    return apiSuccess({ id: sent.id, status: sent.status, sentAt: sent.sentAt });
  } catch (error) {
    return clientIncidentError(error, "draft send");
  }
}
