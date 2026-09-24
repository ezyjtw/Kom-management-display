/** GET /api/fab — FAB instruction register, settlement log and fee balances (spec §12 TASK-FAB; module.fab). */
import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { fabGuard } from "@/modules/fab/route-helpers";
import { fabRegister } from "@/modules/fab/register";

export async function GET(request: NextRequest) {
  const auth = await fabGuard(request, false);
  if (auth instanceof NextResponse) return auth;
  try {
    return apiSuccess(await fabRegister());
  } catch (error) {
    return handleApiError(error, "fab GET");
  }
}
