/** POST /api/daily-checks/items/:id/collect — run the automated data pull now (spec §12, b). Proposes evidence; does not pass the check. */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiForbiddenError, apiNotFoundError, apiSuccess, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { collectForItem } from "@/modules/daily-checks/collectors";
import { canViewKps } from "@/modules/kps/access";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "daily_check", "update");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;
  try {
    const { id } = await params;
    const item = await prisma.dailyCheckItem.findUnique({ where: { id }, include: { definition: { select: { restricted: true } } } });
    if (!item) return apiNotFoundError("Daily check item");
    if (item.definition?.restricted && !(await canViewKps(auth))) return apiForbiddenError("Requires kps:view");
    const result = await collectForItem(id);
    if (!result) return NextResponse.json({ success: false, error: "This check has no automated data pull; enter the evidence manually." }, { status: 422 });
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error, "daily-check collect");
  }
}
