/** GET /api/clients/overview — per client open items, SLA status, activity, logged effort (team level) and channels (spec §14.1). */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { clientsOverview } from "@/modules/clients/overview";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "view");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.read);
  if (limited) return limited;
  try {
    return apiSuccess({ clients: await clientsOverview(), asOf: new Date().toISOString() });
  } catch (error) {
    return handleApiError(error, "clients overview GET");
  }
}
