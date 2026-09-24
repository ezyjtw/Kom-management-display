/** GET /api/work-items/:id — header, SLA status and timeline (spec §14.2). */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiNotFoundError, apiSuccess, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { workItemDetail } from "@/modules/work-items/detail";
import { workItemScopeGuard } from "@/modules/auth/client-scope";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "view");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.read);
  if (limited) return limited;
  try {
    const { id } = await params;
    const outOfScope = await workItemScopeGuard(auth, id);
    if (outOfScope) return outOfScope;
    const detail = await workItemDetail(id);
    return detail ? apiSuccess(detail) : apiNotFoundError("Work item");
  } catch (error) {
    return handleApiError(error, "work-item GET");
  }
}
