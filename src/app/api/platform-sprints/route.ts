/** GET /api/platform-sprints — sprints with dates, change items, task mapping, UAT outcomes and the gate (spec §16.7). */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { sprintsView } from "@/modules/platform-sprints/view";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "view");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.read);
  if (limited) return limited;
  try {
    return apiSuccess({ sprints: await sprintsView(), canRun: auth.role === "admin" || auth.role === "lead" });
  } catch (error) {
    return handleApiError(error, "platform sprints GET");
  }
}
