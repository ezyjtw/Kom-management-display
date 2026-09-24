/** GET /api/bank — BANK instruction register, settlement log and fee balances (spec §12 TASK-BANK; module.bank). */
import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { bankGuard } from "@/modules/bank/route-helpers";
import { bankRegister } from "@/modules/bank/register";

export async function GET(request: NextRequest) {
  const auth = await bankGuard(request, false);
  if (auth instanceof NextResponse) return auth;
  try {
    return apiSuccess(await bankRegister());
  } catch (error) {
    return handleApiError(error, "bank GET");
  }
}
