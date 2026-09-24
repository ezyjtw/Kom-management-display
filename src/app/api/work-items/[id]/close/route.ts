/**
 * POST /api/work-items/:id/close — close with a write-up (spec §10.2).
 * 422 with the list of problems when the write-up is incomplete; the same
 * validation runs again before the Jira/JSM transition.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { auditedAction } from "@/lib/api/audit";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { closeWorkItemSchema, validateBody } from "@/lib/validation";
import { closeWorkItem, WorkItemStateError } from "@/modules/work-items/closure";
import { ClosureValidationError } from "@/modules/work-items/closure-rules";
import { TicketWriteError } from "@/modules/work-items/ticket-writeback";
import { auditActor } from "@/modules/core-data/audit-actor";
import { ClientContentError } from "@/modules/client-incidents/guards";
import { workItemScopeGuard } from "@/modules/auth/client-scope";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "resolve");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  const parsed = validateBody(closeWorkItemSchema, await request.json().catch(() => ({})));
  if (!parsed.success) return apiValidationError(parsed.error);

  try {
    const { id } = await params;
    const outOfScope = await workItemScopeGuard(auth, id);
    if (outOfScope) return outOfScope;
    const actor = auditActor(auth);
    const updated = await auditedAction(
      {
        action: "work_item_closed",
        entityType: "work_item",
        entityId: id,
        userId: actor.userId,
        summary: `Close work item ${id}`,
        after: { timeLogBucketMins: parsed.data.timeLogBucketMins ?? null },
        metadata: actor.metadata,
      },
      async () => closeWorkItem(id, parsed.data, actor.userId, { userId: auth.id, employeeId: auth.employeeId, role: auth.role }),
      (r) => ({ ticketKey: r.ticketKey, state: r.state, rootCause: r.rootCause, riskScore: r.riskScore }),
    );
    return apiSuccess(updated);
  } catch (error) {
    if (error instanceof ClosureValidationError) {
      return NextResponse.json({ success: false, error: error.message, issues: error.issues }, { status: 422 });
    }
    if (error instanceof ClientContentError) {
      return NextResponse.json({ success: false, error: error.message, issues: error.issues }, { status: 422 });
    }
    if (error instanceof WorkItemStateError) return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    if (error instanceof TicketWriteError) {
      const status = error.message === "Work item not found" ? 404 : 409;
      return NextResponse.json({ success: false, error: error.message }, { status });
    }
    return handleApiError(error, "work-item close");
  }
}
