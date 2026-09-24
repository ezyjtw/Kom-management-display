/** POST /api/incident-log-drafts/:id/complete — mark an INC draft completed (spec §10.4). Behind incident_log.drafts.enabled. */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { featureGate } from "@/lib/feature-gate";
import { auditedAction } from "@/lib/api/audit";
import { prisma } from "@/lib/prisma";
import { apiNotFoundError, apiSuccess, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { completeIncidentLogDraft } from "@/modules/incident-log/drafts";
import { auditActor } from "@/modules/core-data/audit-actor";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gated = await featureGate("incident_log.drafts.enabled");
  if (gated) return gated;
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "update");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const { id } = await params;
    const existing = await prisma.incidentLogDraft.findUnique({ where: { id }, select: { jiraKey: true } });
    if (!existing) return apiNotFoundError("INC draft");
    const actor = auditActor(auth);
    const draft = await auditedAction(
      {
        action: "incident_log_draft_completed",
        entityType: "incident_log_draft",
        entityId: id,
        userId: actor.userId,
        summary: `Complete INC draft ${existing.jiraKey ?? id}`,
        metadata: actor.metadata,
      },
      async () => completeIncidentLogDraft(id),
      (r) => ({ completedAt: r?.completedAt ?? null }),
    );
    if (!draft) return apiNotFoundError("INC draft");
    return apiSuccess(draft);
  } catch (error) {
    return handleApiError(error, "incidentLog draft complete");
  }
}
