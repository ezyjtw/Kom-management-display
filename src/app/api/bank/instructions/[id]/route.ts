/** PATCH /api/bank/instructions/:id — record the ACK/NACK that was sent, or the corrected instruction's reference. Sends nothing to BANK. */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiNotFoundError, apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { validateBody } from "@/lib/validation";
import { auditedAction } from "@/lib/api/audit";
import { auditActor } from "@/modules/core-data/audit-actor";
import { bankGuard } from "@/modules/bank/route-helpers";
import { instructionUpdateSchema } from "@/modules/bank/register";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await bankGuard(request, true);
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const parsed = validateBody(instructionUpdateSchema, await request.json());
    if (!parsed.success) return apiValidationError(parsed.error);
    const before = await prisma.bankInstruction.findUnique({ where: { id } });
    if (!before) return apiNotFoundError("BANK instruction");
    const { ackSentAt, ...rest } = parsed.data;
    const actor = auditActor(auth);
    const row = await auditedAction(
      { action: "bank_instruction_updated", entityType: "bank_instruction", entityId: id, userId: actor.userId, summary: `Update BANK ${before.reference}`, before: { ackStatus: before.ackStatus, correctedByRef: before.correctedByRef }, metadata: actor.metadata },
      async () => prisma.bankInstruction.update({
        where: { id },
        data: { ...rest, ...(ackSentAt ? { ackSentAt: new Date(ackSentAt) } : rest.ackStatus && rest.ackStatus !== "none" && !before.ackSentAt ? { ackSentAt: new Date() } : {}) },
      }),
      (r) => ({ ackStatus: r.ackStatus, correctedByRef: r.correctedByRef }),
    );
    return apiSuccess(row);
  } catch (error) {
    return handleApiError(error, "bank instruction PATCH");
  }
}
