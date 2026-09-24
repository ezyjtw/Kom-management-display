/** PATCH /api/fab/instructions/:id — record the ACK/NACK that was sent, or the corrected instruction's reference. Sends nothing to FAB. */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiNotFoundError, apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { validateBody } from "@/lib/validation";
import { auditedAction } from "@/lib/api/audit";
import { auditActor } from "@/modules/core-data/audit-actor";
import { fabGuard } from "@/modules/fab/route-helpers";
import { instructionUpdateSchema } from "@/modules/fab/register";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await fabGuard(request, true);
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const parsed = validateBody(instructionUpdateSchema, await request.json());
    if (!parsed.success) return apiValidationError(parsed.error);
    const before = await prisma.fabInstruction.findUnique({ where: { id } });
    if (!before) return apiNotFoundError("FAB instruction");
    const { ackSentAt, ...rest } = parsed.data;
    const actor = auditActor(auth);
    const row = await auditedAction(
      { action: "fab_instruction_updated", entityType: "fab_instruction", entityId: id, userId: actor.userId, summary: `Update FAB ${before.reference}`, before: { ackStatus: before.ackStatus, correctedByRef: before.correctedByRef }, metadata: actor.metadata },
      async () => prisma.fabInstruction.update({
        where: { id },
        data: { ...rest, ...(ackSentAt ? { ackSentAt: new Date(ackSentAt) } : rest.ackStatus && rest.ackStatus !== "none" && !before.ackSentAt ? { ackSentAt: new Date() } : {}) },
      }),
      (r) => ({ ackStatus: r.ackStatus, correctedByRef: r.correctedByRef }),
    );
    return apiSuccess(row);
  } catch (error) {
    return handleApiError(error, "fab instruction PATCH");
  }
}
