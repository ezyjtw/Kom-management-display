/**
 * GET /api/metrics/:section?from=YYYY-MM-DD&to=YYYY-MM-DD (or ?month=YYYY-MM)
 * Sections: responsiveness, clients, operations, hygiene, client_incidents, polling (spec §13.3).
 * Team and client level only (H4). Each response carries data freshness.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiNotFoundError, apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { parsePeriod, SECTIONS, type SectionName } from "@/modules/metrics/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ section: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "report", "view");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.read);
  if (limited) return limited;
  try {
    const { section } = await params;
    // Own keys only: `in` would also accept inherited names such as "constructor".
    if (!Object.hasOwn(SECTIONS, section)) return apiNotFoundError("Metrics section");
    const period = parsePeriod(new URL(request.url).searchParams);
    if (typeof period === "string") return apiValidationError(period);
    return apiSuccess(await SECTIONS[section as SectionName](period));
  } catch (error) {
    return handleApiError(error, "metrics section GET");
  }
}
