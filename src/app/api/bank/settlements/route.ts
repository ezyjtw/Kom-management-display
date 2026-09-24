/** POST /api/bank/settlements — add a settlement-log row (RECEIVED, INITIATED, COMPLETED or FAILED). */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { validateBody } from "@/lib/validation";
import { auditedAction } from "@/lib/api/audit";
import { auditActor } from "@/modules/core-data/audit-actor";
import { bankGuard } from "@/modules/bank/route-helpers";
import { settlementLogSchema } from "@/modules/bank/register";

export async function POST(request: NextRequest) {
  const auth = await bankGuard(request, true);
  if (auth instanceof NextResponse) return auth;
  try {
    const parsed = validateBody(settlementLogSchema, await request.json());
    if (!parsed.success) return apiValidationError(parsed.error);
    const actor = auditActor(auth);
    // The row id is not known until it is created: it is in the outcome.
    const row = await auditedAction(
      { action: "bank_settlement_logged", entityType: "bank_settlement", entityId: "new", userId: actor.userId, summary: `Log BANK ${parsed.data.reference} ${parsed.data.status}`, metadata: actor.metadata },
      async () => prisma.bankSettlementLog.create({ data: { ...parsed.data, occurredAt: new Date(parsed.data.occurredAt), recordedById: auth.employeeId ?? null } }),
      (r) => ({ settlementId: r.id }),
      { entityId: (r) => r.id },
    );
    return apiSuccess({ ...row, txHash: row.txHash ? "[stored]" : null }, undefined, 201);
  } catch (error) {
    return handleApiError(error, "bank settlement POST");
  }
}
