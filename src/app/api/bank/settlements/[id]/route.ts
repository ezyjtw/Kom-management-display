/** PATCH /api/bank/settlements/:id — record the KYT outcome (fail, escalated, cleared) on a settlement-log row. */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiNotFoundError, apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { validateBody } from "@/lib/validation";
import { auditedAction } from "@/lib/api/audit";
import { auditActor } from "@/modules/core-data/audit-actor";
import { bankGuard } from "@/modules/bank/route-helpers";

const kytSchema = z.object({ kytStatus: z.enum(["none", "fail", "escalated", "cleared"]), notes: z.string().max(2000).optional() });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await bankGuard(request, true);
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const parsed = validateBody(kytSchema, await request.json());
    if (!parsed.success) return apiValidationError(parsed.error);
    const before = await prisma.bankSettlementLog.findUnique({ where: { id } });
    if (!before) return apiNotFoundError("BANK settlement log row");
    const actor = auditActor(auth);
    const row = await auditedAction(
      { action: "bank_settlement_kyt_updated", entityType: "bank_settlement", entityId: id, userId: actor.userId, summary: `Set BANK ${before.reference} KYT ${parsed.data.kytStatus}`, before: { kytStatus: before.kytStatus }, after: { kytStatus: parsed.data.kytStatus }, metadata: actor.metadata },
      async () => prisma.bankSettlementLog.update({ where: { id }, data: parsed.data }),
      (r) => ({ kytStatus: r.kytStatus }),
    );
    return apiSuccess({ ...row, txHash: row.txHash ? "[stored]" : null });
  } catch (error) {
    return handleApiError(error, "bank settlement PATCH");
  }
}
