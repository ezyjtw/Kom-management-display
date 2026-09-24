/** POST /api/daily-checks/items/:id/collect — run the automated data pull now (spec §12, b). Proposes evidence; does not pass the check. */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiForbiddenError, apiNotFoundError, apiSuccess, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { collectForItem } from "@/modules/daily-checks/collectors";
import { canViewKps } from "@/modules/kps/access";
import { auditedResponse } from "@/lib/api/audit";
import { auditActor } from "@/modules/core-data/audit-actor";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "daily_check", "update");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;
  try {
    const auditActorInfo = auditActor(auth);
    // Fail-closed audit (spec §17.7, audit policy: src/lib/api/audit-policy.ts).
    return await auditedResponse(
      { action: "daily_check_collected", entityType: "daily_check", entityId: (await params).id, userId: auditActorInfo.userId, summary: "Collect daily check evidence", metadata: auditActorInfo.metadata },
      async () => {
        const { id } = await params;
        const item = await prisma.dailyCheckItem.findUnique({ where: { id }, include: { definition: { select: { restricted: true } } } });
        if (!item) return apiNotFoundError("Daily check item");
        if (item.definition?.restricted && !(await canViewKps(auth))) return apiForbiddenError("Requires kps:view");
        const result = await collectForItem(id);
        if (!result) return NextResponse.json({ success: false, error: "This check has no automated data pull; enter the evidence manually." }, { status: 422 });
        return apiSuccess(result);
      },
    );
  } catch (error) {
    return handleApiError(error, "daily-check collect");
  }
}
