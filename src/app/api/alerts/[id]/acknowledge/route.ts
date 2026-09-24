/**
 * POST /api/alerts/:id/acknowledge — 422 unless the alert is linked to a
 * WorkItem with a ticket (spec §10.2).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { auditedAction } from "@/lib/api/audit";
import { apiNotFoundError, apiSuccess, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { acknowledgeBlocker } from "@/modules/alerting/acknowledge";
import { auditActor } from "@/modules/core-data/audit-actor";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "alert", "acknowledge");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const { id } = await params;
    const alert = await prisma.alert.findUnique({ where: { id } });
    if (!alert) return apiNotFoundError("Alert");
    if (alert.status !== "active") {
      return NextResponse.json({ success: false, error: `Alert is already ${alert.status}.` }, { status: 409 });
    }
    const blocker = await acknowledgeBlocker(id);
    if (blocker) return NextResponse.json({ success: false, error: blocker }, { status: 422 });

    const actor = auditActor(auth);
    const updated = await auditedAction(
      {
        action: "alert_acknowledge",
        entityType: "alert",
        entityId: id,
        userId: actor.userId,
        summary: `Acknowledge alert ${alert.ruleCode}`,
        before: { status: alert.status },
        after: { status: "acknowledged", workItemId: alert.workItemId },
        metadata: actor.metadata,
      },
      async () => prisma.alert.update({ where: { id }, data: { status: "acknowledged", acknowledgedAt: new Date() } }),
      (r) => ({ status: r.status, acknowledgedAt: r.acknowledgedAt }),
    );
    return apiSuccess(updated);
  } catch (error) {
    return handleApiError(error, "alert acknowledge");
  }
}
