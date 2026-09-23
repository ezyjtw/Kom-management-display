/** POST /api/iai-drafts/:id/complete — mark an IAI draft completed (spec §10.4). Behind iai.drafts.enabled. */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { featureGate } from "@/lib/feature-gate";
import { createAuditEntry } from "@/lib/api/audit";
import { apiNotFoundError, apiSuccess, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { completeIaiDraft } from "@/modules/iai/drafts";
import { auditActor } from "@/modules/core-data/audit-actor";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gated = await featureGate("iai.drafts.enabled");
  if (gated) return gated;
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "update");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const { id } = await params;
    const draft = await completeIaiDraft(id);
    if (!draft) return apiNotFoundError("IAI draft");
    const actor = auditActor(auth);
    await createAuditEntry({
      action: "iai_draft_completed",
      entityType: "iai_draft",
      entityId: id,
      userId: actor.userId,
      summary: `IAI draft ${draft.jiraKey ?? id} completed`,
      metadata: actor.metadata,
    });
    return apiSuccess(draft);
  } catch (error) {
    return handleApiError(error, "iai draft complete");
  }
}
