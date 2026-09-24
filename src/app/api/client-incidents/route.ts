/**
 * POST /api/client-incidents — raise an incident or risk from a message
 * (spec §9.7). Creates the internal entry and ticket and, unless the category
 * is compliance-sensitive, a client-specific JSM request. Audit-logged.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { createAuditEntry } from "@/lib/api/audit";
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
    const result = await raiseClientEntry(parsed.data, { userId: auth.id, employeeId: auth.employeeId, role: auth.role });
    const actor = auditActor(auth);
    await createAuditEntry({
      action: `client_${parsed.data.type}_raised`,
      entityType: "work_item",
      entityId: result.workItem.id,
      userId: actor.userId,
      summary: `Client ${parsed.data.type} raised (${parsed.data.severity}, ${parsed.data.category})${result.withheld ? "; client ticket withheld (compliance-sensitive)" : ""}`,
      after: { internalTicket: result.workItem.ticketKey, clientTicket: result.clientTicket?.key ?? null, withheld: result.withheld },
      metadata: actor.metadata,
    });
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
