/**
 * POST /api/client-incidents — raise an incident or risk from a message
 * (spec §9.7). Creates the internal entry and ticket and, unless the category
 * is compliance-sensitive, a client-specific JSM request. Audit-logged.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { auditedAction } from "@/lib/api/audit";
import { apiSuccess, apiValidationError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/validation";
import { raiseClientEntry, raiseSchema } from "@/modules/client-incidents/service";
import { clientIncidentError } from "@/modules/client-incidents/http";
import { auditActor } from "@/modules/core-data/audit-actor";

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "update");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;
  try {
    const parsed = validateBody(raiseSchema, await request.json());
    if (!parsed.success) return apiValidationError(parsed.error);
    const actor = auditActor(auth);
    // The WorkItem id is not known until it is created: it is in the outcome.
    const result = await auditedAction(
      {
        action: `client_${parsed.data.type}_raised`,
        entityType: "work_item",
        entityId: "new",
        userId: actor.userId,
        summary: `Raise client ${parsed.data.type} (${parsed.data.severity}, ${parsed.data.category})`,
        metadata: actor.metadata,
      },
      async () => raiseClientEntry(parsed.data, { userId: auth.id, employeeId: auth.employeeId, role: auth.role }),
      (r) => ({ workItemId: r.workItem.id, internalTicket: r.workItem.ticketKey, clientTicket: r.clientTicket?.key ?? null, withheld: r.withheld }),
      { entityId: (r) => r.workItem.id },
    );
    return apiSuccess({
      id: result.workItem.id,
      ticketKey: result.workItem.ticketKey,
      clientTicket: result.clientTicket,
      withheld: result.withheld,
      draftId: result.draftId,
      warnings: result.warnings,
    }, undefined, 201);
  } catch (error) {
    return clientIncidentError(error, "client-incident POST");
  }
}
