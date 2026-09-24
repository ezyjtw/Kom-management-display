/**
 * POST /api/client-incidents/:id/updates/:updateId/review — second team member
 * reviews an outbound client update and posts it (four-eyes, spec §9.7). This is
 * a review of client communication, not a transaction approval (H1).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { createAuditEntry } from "@/lib/api/audit";
import { apiSuccess } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { approveClientUpdate } from "@/modules/client-incidents/service";
import { clientIncidentError } from "@/modules/client-incidents/http";
import { auditActor } from "@/modules/core-data/audit-actor";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; updateId: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "update");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;
  try {
    const { id, updateId } = await params;
    const update = await approveClientUpdate(id, updateId, { userId: auth.id, employeeId: auth.employeeId, role: auth.role });
    const actor = auditActor(auth);
    await createAuditEntry({ action: "client_update_second_approver", entityType: "work_item", entityId: id, userId: actor.userId, summary: "Client update reviewed by a second team member and posted", metadata: actor.metadata });
    return apiSuccess(update);
  } catch (error) {
    return clientIncidentError(error, "client update approve");
  }
}
