/**
 * POST /api/daily-checks/items/:id/skip-signoff — a lead or admin other than
 * the requester approves a skip (spec §10.2).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { createAuditEntry } from "@/lib/api/audit";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { approveSkip, DailyCheckRuleError } from "@/modules/daily-checks/enforcement";
import { isRestrictedItemFor } from "@/modules/kps/access";
import { auditActor } from "@/modules/core-data/audit-actor";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "daily_check", "update");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const { id } = await params;
    if (await isRestrictedItemFor(id, auth)) return NextResponse.json({ success: false, error: "Restricted check: requires kps:view." }, { status: 403 });
    const item = await approveSkip(id, { id: auth.id, role: auth.role });
    const actor = auditActor(auth);
    await createAuditEntry({
      action: "daily_check_skip_approved",
      entityType: "daily_check",
      entityId: id,
      userId: actor.userId,
      summary: `Skip approved: ${item.skippedReason ?? ""}`,
      after: { status: "skipped", requestedBy: item.skipRequestedBy },
      metadata: actor.metadata,
    });
    return apiSuccess(item);
  } catch (error) {
    if (error instanceof DailyCheckRuleError) {
      return NextResponse.json({ success: false, error: error.message, issues: error.issues }, { status: error.status });
    }
    return handleApiError(error, "daily-check approve skip");
  }
}
