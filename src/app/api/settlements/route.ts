/**
 * GET /api/settlements?date=YYYY-MM-DD — read-only OES settlement matching
 * view from the custody API snapshots (spec §12 CHK-10). The maker/checker
 * "approval" actions were removed: settlement approvals happen in the
 * platforms (H1). Notes: POST /api/settlements/notes.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { buildSettlementView } from "@/modules/settlements/matching-view";
import { londonParts } from "@/modules/alerting/calendar";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "settlement", "view");
  if (authz instanceof NextResponse) return authz;
  try {
    const date = new URL(request.url).searchParams.get("date") ?? londonParts(new Date()).date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return apiValidationError("date must be YYYY-MM-DD");
    return apiSuccess(await buildSettlementView(date));
  } catch (error) {
    return handleApiError(error, "settlements GET");
  }
}
