/** POST /api/bank/fee-balances — manual fee-reserve balance entry for ALR-BANK-08 (CONFIRM-FEE-ALERT-FORMAT). */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { validateBody } from "@/lib/validation";
import { bankGuard } from "@/modules/bank/route-helpers";
import { feeBalanceSchema } from "@/modules/bank/register";
import { auditedResponse } from "@/lib/api/audit";
import { auditActor } from "@/modules/core-data/audit-actor";

export async function POST(request: NextRequest) {
  const auth = await bankGuard(request, true);
  if (auth instanceof NextResponse) return auth;
  try {
    const auditActorInfo = auditActor(auth);
    // Fail-closed audit (spec §17.7, audit policy: src/lib/api/audit-policy.ts).
    return await auditedResponse(
      { action: "bank_fee_balance_recorded", entityType: "bank_fee_balance", entityId: "new", userId: auditActorInfo.userId, summary: "Record a BANK fee balance", metadata: auditActorInfo.metadata },
      async () => {
        const parsed = validateBody(feeBalanceSchema, await request.json());
        if (!parsed.success) return apiValidationError(parsed.error);
        return apiSuccess(await prisma.bankFeeBalance.create({ data: { ...parsed.data, recordedById: auth.employeeId ?? null } }), undefined, 201);
      },
    );
  } catch (error) {
    return handleApiError(error, "bank fee balance POST");
  }
}
