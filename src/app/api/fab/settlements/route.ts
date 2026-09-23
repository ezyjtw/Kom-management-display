/** POST /api/fab/settlements — add a settlement-log row (RECEIVED, INITIATED, COMPLETED or FAILED). */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { validateBody } from "@/lib/validation";
import { createAuditEntry } from "@/lib/api/audit";
import { auditActor } from "@/modules/core-data/audit-actor";
import { fabGuard } from "@/modules/fab/route-helpers";
import { settlementLogSchema } from "@/modules/fab/register";

export async function POST(request: NextRequest) {
  const auth = await fabGuard(request, true);
  if (auth instanceof NextResponse) return auth;
  try {
    const parsed = validateBody(settlementLogSchema, await request.json());
    if (!parsed.success) return apiValidationError(parsed.error);
    const row = await prisma.fabSettlementLog.create({ data: { ...parsed.data, occurredAt: new Date(parsed.data.occurredAt), recordedById: auth.employeeId ?? null } });
    const actor = auditActor(auth);
    await createAuditEntry({ action: "fab_settlement_logged", entityType: "fab_settlement", entityId: row.id, userId: actor.userId, summary: `FAB ${row.reference} ${row.status}`, metadata: actor.metadata });
    return apiSuccess({ ...row, txHash: row.txHash ? "[stored]" : null }, undefined, 201);
  } catch (error) {
    return handleApiError(error, "fab settlement POST");
  }
}
