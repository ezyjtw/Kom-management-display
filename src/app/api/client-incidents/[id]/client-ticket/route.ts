/**
 * POST /api/client-incidents/:id/client-ticket — create the client request:
 * - withheld (compliance-sensitive) entries: admin only, with a recorded
 *   Compliance decision reference (required, audit-logged) (spec §9.7, H12);
 * - otherwise: retry after a failed creation.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { auditedAction } from "@/lib/api/audit";
import { apiNotFoundError, apiSuccess, apiValidationError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/validation";
import { clientEntryMeta, releaseWithheldClientRequest, retryClientRequest } from "@/modules/client-incidents/service";
import { clientIncidentError } from "@/modules/client-incidents/http";
import { auditActor } from "@/modules/core-data/audit-actor";

const bodySchema = z.object({ complianceDecisionRef: z.string().trim().min(3).max(200).optional() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "update");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;
  try {
    const { id } = await params;
    const parsed = validateBody(bodySchema, await request.json().catch(() => ({})));
    if (!parsed.success) return apiValidationError(parsed.error);
    const item = await prisma.workItem.findUnique({ where: { id } });
    if (!item) return apiNotFoundError("Client incident or risk");
    const withheld = clientEntryMeta(item).clientTicketBlocked === "compliance_sensitive";
    const actor = auditActor(auth);
    if (withheld) {
      if (!parsed.data.complianceDecisionRef) {
        return NextResponse.json({ success: false, error: "A Compliance decision reference is required to create a client request for a compliance-sensitive entry." }, { status: 422 });
      }
      const complianceDecisionRef = parsed.data.complianceDecisionRef;
      const created = await auditedAction(
        {
          action: "client_ticket_released_after_compliance_decision",
          entityType: "work_item",
          entityId: id,
          userId: actor.userId,
          summary: `Create client request for ${item.ticketKey ?? id} after Compliance decision ${complianceDecisionRef}`,
          after: { complianceDecisionRef },
          metadata: actor.metadata,
        },
        async () => releaseWithheldClientRequest(id, complianceDecisionRef, { userId: auth.id, employeeId: auth.employeeId, role: auth.role }),
        (r) => ({ clientTicketKey: r.key }),
      );
      return apiSuccess(created, undefined, 201);
    }
    const created = await auditedAction(
      { action: "client_ticket_created", entityType: "work_item", entityId: id, userId: actor.userId, summary: `Create client request for ${item.ticketKey ?? id}`, metadata: actor.metadata },
      async () => retryClientRequest(id),
      (r) => ({ clientTicketKey: r.key }),
    );
    return apiSuccess(created, undefined, 201);
  } catch (error) {
    return clientIncidentError(error, "client-ticket POST");
  }
}
