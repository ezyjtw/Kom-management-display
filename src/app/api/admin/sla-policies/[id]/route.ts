import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { createAuditEntry } from "@/lib/api/audit";
import { apiSuccess, apiValidationError, apiNotFoundError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody, updateSlaPolicySchema } from "@/lib/validation";
import { auditActor } from "@/modules/core-data/audit-actor";

const TRACKED = ["description", "ownershipMins", "firstRespMins", "resolveMins", "resolveRule", "calendar", "warnAtPct", "breachEscalationRole", "isActive"] as const;

/** PATCH /api/admin/sla-policies/:id — set targets (admin). Bumps the version; audit-logged. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "sla_policy", "configure");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const { id } = await params;
    const parsed = validateBody(updateSlaPolicySchema, await request.json());
    if (!parsed.success) return apiValidationError(parsed.error);

    const before = await prisma.slaPolicy.findUnique({ where: { id } });
    if (!before) return apiNotFoundError("SLA policy");

    const policy = await prisma.slaPolicy.update({
      where: { id },
      data: { ...parsed.data, version: { increment: 1 } },
    });

    const actor = auditActor(auth);
    await createAuditEntry({
      action: "sla_policy_updated",
      entityType: "sla_policy",
      entityId: id,
      userId: actor.userId,
      summary: `SLA policy ${policy.code} updated to v${policy.version}`,
      before: Object.fromEntries(TRACKED.map((k) => [k, before[k]])),
      after: Object.fromEntries(TRACKED.map((k) => [k, policy[k]])),
      metadata: actor.metadata,
    });

    return apiSuccess(policy);
  } catch (error) {
    return handleApiError(error, "admin sla-policy PATCH");
  }
}
