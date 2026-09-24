/**
 * Shared handler for work item action routes (spec §14.2): auth, rate limit,
 * body validation, audit entry and error mapping.
 */
import { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import { requireAuth, type AuthUser } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { auditedAction } from "@/lib/api/audit";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/validation";
import { auditActor } from "@/modules/core-data/audit-actor";
import { WorkActionError, type Actor } from "@/modules/work-items/actions";
import { TicketWriteError } from "@/modules/work-items/ticket-writeback";

export function workActionError(error: unknown, context: string): NextResponse {
  if (error instanceof WorkActionError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
  if (error instanceof TicketWriteError) return NextResponse.json({ success: false, error: error.message }, { status: 409 });
  return handleApiError(error, context);
}

export const actorOf = (auth: AuthUser): Actor => ({ userId: auth.id, employeeId: auth.employeeId ?? null, role: auth.role });

export async function workAction<T, R>(
  request: NextRequest,
  params: Promise<{ id: string }>,
  schema: z.ZodSchema<T>,
  opts: { action: string; context: string; run: (id: string, body: T, auth: AuthUser) => Promise<R>; summary: (id: string, body: T) => string },
): Promise<NextResponse> {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "update");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;
  try {
    const parsed = validateBody(schema, await request.json().catch(() => ({})));
    if (!parsed.success) return apiValidationError(parsed.error);
    const { id } = await params;
    const actor = auditActor(auth);
    // Fail-closed: no audit entry, no action (control-relevant work item change).
    const result = await auditedAction(
      { action: opts.action, entityType: "work_item", entityId: id, userId: actor.userId, summary: opts.summary(id, parsed.data), metadata: actor.metadata },
      () => opts.run(id, parsed.data, auth),
    );
    return apiSuccess(result);
  } catch (error) {
    return workActionError(error, opts.context);
  }
}
