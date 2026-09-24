/**
 * POST /api/daily-checks/items/:id/exceptions — record structured exceptions
 * (spec §10.1/§10.2). Each row becomes a WorkItem with a ticket in the check's
 * ticket project; the item moves to issues_found.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { auditedAction } from "@/lib/api/audit";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { dailyCheckExceptionsSchema } from "@/lib/validation";
import { DailyCheckRuleError, recordExceptions } from "@/modules/daily-checks/enforcement";
import { isRestrictedItemFor } from "@/modules/realisations/access";
import { auditActor } from "@/modules/core-data/audit-actor";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "daily_check", "update");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  const parsed = dailyCheckExceptionsSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Enter each exception as a row with a summary (5–200 characters).", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      { status: 422 },
    );
  }

  try {
    const { id } = await params;
    if (await isRestrictedItemFor(id, auth)) return NextResponse.json({ success: false, error: "Restricted check: requires realisation:view." }, { status: 403 });
    const actor = auditActor(auth);
    const result = await auditedAction(
      {
        action: "daily_check_exceptions_recorded",
        entityType: "daily_check",
        entityId: id,
        userId: actor.userId,
        summary: `Record ${parsed.data.exceptions.length} exception(s)`,
        metadata: actor.metadata,
      },
      async () => recordExceptions(id, parsed.data.exceptions, auth.employeeId || auth.id),
      (r) => ({ workItemIds: r.workItemIds, unticketed: r.unticketed }),
    );
    return apiSuccess(result);
  } catch (error) {
    if (error instanceof DailyCheckRuleError) {
      return NextResponse.json({ success: false, error: error.message, issues: error.issues }, { status: error.status });
    }
    return handleApiError(error, "daily-check exceptions");
  }
}
