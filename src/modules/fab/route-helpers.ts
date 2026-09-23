import { NextRequest, NextResponse } from "next/server";
import { requireAuth, type AuthUser } from "@/lib/auth-user";
import { featureGate } from "@/lib/feature-gate";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

/** module.fab gate (404 when off), auth, and read or write permission. */
export async function fabGuard(request: NextRequest, write: boolean): Promise<AuthUser | NextResponse> {
  const gated = await featureGate("module.fab");
  if (gated) return gated;
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = write ? requireAuthorization(auth, "work_item", "update") : requireAuthorization(auth, "settlement", "view");
  if (authz instanceof NextResponse) return authz;
  if (write) {
    const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
    if (limited) return limited;
  }
  return auth;
}
