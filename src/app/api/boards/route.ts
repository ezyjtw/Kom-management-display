/** GET /api/boards?team=Team%201 — team board (spec §12, f). Definitions are synced and today's items generated on read. */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { buildBoard } from "@/modules/daily-checks/board";
import { generateDailyItems } from "@/modules/daily-checks/schedule";
import { canViewRealisations } from "@/modules/realisations/access";

const TEAMS = ["Team 1", "Team 2", "Team 3", "All"];

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "daily_check", "view");
  if (authz instanceof NextResponse) return authz;
  try {
    const team = new URL(request.url).searchParams.get("team");
    if (team && !TEAMS.includes(team)) return apiValidationError(`team must be one of: ${TEAMS.join(", ")}`);
    await generateDailyItems();
    return apiSuccess(await buildBoard(team && team !== "All" ? team : null, { canViewRealisations: await canViewRealisations(auth) }));
  } catch (error) {
    return handleApiError(error, "boards GET");
  }
}
