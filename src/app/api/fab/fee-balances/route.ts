/** POST /api/fab/fee-balances — manual fee-reserve balance entry for ALR-FAB-08 (CONFIRM-FEE-ALERT-FORMAT). */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { validateBody } from "@/lib/validation";
import { fabGuard } from "@/modules/fab/route-helpers";
import { feeBalanceSchema } from "@/modules/fab/register";

export async function POST(request: NextRequest) {
  const auth = await fabGuard(request, true);
  if (auth instanceof NextResponse) return auth;
  try {
    const parsed = validateBody(feeBalanceSchema, await request.json());
    if (!parsed.success) return apiValidationError(parsed.error);
    return apiSuccess(await prisma.fabFeeBalance.create({ data: { ...parsed.data, recordedById: auth.employeeId ?? null } }), undefined, 201);
  } catch (error) {
    return handleApiError(error, "fab fee balance POST");
  }
}
