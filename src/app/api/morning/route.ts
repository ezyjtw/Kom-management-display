/** GET /api/morning — the morning board (spec §14.3). Built only from tickets and WorkItems. */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { buildMorningBoard } from "@/modules/morning/board";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "view");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.read);
  if (limited) return limited;
  try {
    const board = await buildMorningBoard();
    // Which teams' handover this user may change (the lead, the deputy or an admin); the API enforces it again.
    const canManage = board.teams
      .filter((t) => t.team !== "All" && (auth.role === "admin" || (!!auth.employeeId && (t.lead?.id === auth.employeeId || t.deputyId === auth.employeeId))))
      .map((t) => t.team);
    return apiSuccess({ ...board, me: { employeeId: auth.employeeId ?? null, role: auth.role, canManage } });
  } catch (error) {
    return handleApiError(error, "morning board GET");
  }
}
