import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { createAuditEntry } from "@/lib/api/audit";
import { apiSuccess, apiValidationError, apiNotFoundError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody, updateAlertRuleSchema } from "@/lib/validation";
import { auditActor } from "@/modules/core-data/audit-actor";
import { missingConfirmParams } from "@/modules/alerting/catalogue";

/**
 * PATCH /api/admin/alert-rules/:code — tune a rule without a deploy (admin only).
 * `params` is merged into the stored params. Enabling a rule whose CONFIRM
 * placeholders are unset returns 422 listing them. Bumps the version; every
 * change is audit-logged with before and after.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "alert_rule", "configure");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const { code } = await params;
    const parsed = validateBody(updateAlertRuleSchema, await request.json());
    if (!parsed.success) return apiValidationError(parsed.error);
    const { params: ruleParams, route, ...rest } = parsed.data;

    const before = await prisma.alertRule.findUnique({ where: { code } });
    if (!before) return apiNotFoundError("Alert rule");

    // Spec §11.2/§11.5: CONFIRM placeholders block enabling.
    const nextParams = ruleParams ? { ...(before.params as Record<string, unknown>), ...ruleParams } : before.params;
    const willBeEnabled = rest.enabled ?? before.enabled;
    const missing = missingConfirmParams(code, nextParams);
    if (willBeEnabled && missing.length) {
      return NextResponse.json(
        { success: false, error: `${code} cannot be enabled until its CONFIRM parameters are set: ${missing.join(", ")}.`, missing },
        { status: 422 },
      );
    }

    const rule = await prisma.alertRule.update({
      where: { code },
      data: {
        ...rest,
        ...(ruleParams ? { params: nextParams as Prisma.InputJsonValue } : {}),
        ...(route ? { route: route as Prisma.InputJsonValue } : {}),
        version: { increment: 1 },
      },
    });

    const actor = auditActor(auth);
    await createAuditEntry({
      action: "alert_rule_updated",
      entityType: "alert_rule",
      entityId: code,
      userId: actor.userId,
      summary: `Alert rule ${code} updated to v${rule.version}`,
      before: { enabled: before.enabled, severity: before.severity, params: before.params, route: before.route },
      after: { enabled: rule.enabled, severity: rule.severity, params: rule.params, route: rule.route },
      metadata: actor.metadata,
    });

    return apiSuccess(rule);
  } catch (error) {
    return handleApiError(error, "admin alert-rule PATCH");
  }
}
