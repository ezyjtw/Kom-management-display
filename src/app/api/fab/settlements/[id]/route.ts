/** PATCH /api/fab/settlements/:id — record the KYT outcome (fail, escalated, cleared) on a settlement-log row. */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiNotFoundError, apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { validateBody } from "@/lib/validation";
import { auditedAction } from "@/lib/api/audit";
import { auditActor } from "@/modules/core-data/audit-actor";
import { fabGuard } from "@/modules/fab/route-helpers";

const kytSchema = z.object({ kytStatus: z.enum(["none", "fail", "escalated", "cleared"]), notes: z.string().max(2000).optional() });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await fabGuard(request, true);
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const parsed = validateBody(kytSchema, await request.json());
    if (!parsed.success) return apiValidationError(parsed.error);
    const before = await prisma.fabSettlementLog.findUnique({ where: { id } });
    if (!before) return apiNotFoundError("FAB settlement log row");
    const actor = auditActor(auth);
    const row = await auditedAction(
      { action: "fab_settlement_kyt_updated", entityType: "fab_settlement", entityId: id, userId: actor.userId, summary: `Set FAB ${before.reference} KYT ${parsed.data.kytStatus}`, before: { kytStatus: before.kytStatus }, after: { kytStatus: parsed.data.kytStatus }, metadata: actor.metadata },
      async () => prisma.fabSettlementLog.update({ where: { id }, data: parsed.data }),
      (r) => ({ kytStatus: r.kytStatus }),
    );
    return apiSuccess({ ...row, txHash: row.txHash ? "[stored]" : null });
  } catch (error) {
    return handleApiError(error, "fab settlement PATCH");
  }
}
