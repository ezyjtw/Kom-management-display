/** Shared handler for the handover routes: auth, validation, audit and error mapping. */
import { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import { requireAuth, type AuthUser } from "@/lib/auth-user";
import { createAuditEntry } from "@/lib/api/audit";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/validation";
import { auditActor } from "@/modules/core-data/audit-actor";
import { HandoverError } from "@/modules/morning/handover";
import { TicketWriteError } from "@/modules/work-items/ticket-writeback";

export async function handoverAction<T, R extends { id: string }>(
  request: NextRequest,
  schema: z.ZodSchema<T>,
  opts: { action: string; run: (body: T, auth: AuthUser) => Promise<R>; summary: (body: T) => string },
): Promise<NextResponse> {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;
  try {
    const parsed = validateBody(schema, await request.json().catch(() => ({})));
    if (!parsed.success) return apiValidationError(parsed.error);
    const row = await opts.run(parsed.data, auth);
    const actor = auditActor(auth);
    await createAuditEntry({ action: opts.action, entityType: "lead_handover", entityId: row.id, userId: actor.userId, summary: opts.summary(parsed.data), metadata: actor.metadata });
    return apiSuccess(row);
  } catch (error) {
    if (error instanceof HandoverError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    if (error instanceof TicketWriteError) return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    return handleApiError(error, opts.action);
  }
}
