/** POST /api/fab/instructions — add an instruction to the register; opens its ticket (one per reference). */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { apiConflictError, apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { validateBody } from "@/lib/validation";
import { auditedAction } from "@/lib/api/audit";
import { auditActor } from "@/modules/core-data/audit-actor";
import { fabGuard } from "@/modules/fab/route-helpers";
import { createInstruction, instructionSchema } from "@/modules/fab/register";

export async function POST(request: NextRequest) {
  const auth = await fabGuard(request, true);
  if (auth instanceof NextResponse) return auth;
  try {
    const parsed = validateBody(instructionSchema, await request.json());
    if (!parsed.success) return apiValidationError(parsed.error);
    const actor = auditActor(auth);
    // The row id is not known until it is created: it is in the outcome.
    const row = await auditedAction(
      { action: "fab_instruction_recorded", entityType: "fab_instruction", entityId: "new", userId: actor.userId, summary: `Record FAB ${parsed.data.messageType} ${parsed.data.reference}`, metadata: actor.metadata },
      async () => createInstruction(parsed.data, auth.employeeId ?? null),
      (r) => ({ instructionId: r.id }),
      { entityId: (r) => r.id },
    );
    return apiSuccess(row, undefined, 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return apiConflictError("An instruction with this reference is already in the register");
    return handleApiError(error, "fab instruction POST");
  }
}
