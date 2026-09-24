/**
 * POST /api/work-items/:id/not-a-question — one-click close of a client
 * request that is not a question (spec §9.2 rule 7). Needs a controlled
 * reason (422 otherwise). Counted as closed_non_actionable in metrics.
 */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { auditedAction } from "@/lib/api/audit";
import { apiNotFoundError, apiSuccess, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { notAQuestionSchema } from "@/lib/validation";
import { changeState, TicketWriteError } from "@/modules/work-items/ticket-writeback";
import { getSetting } from "@/modules/settings/settings";
import { auditActor } from "@/modules/core-data/audit-actor";
import { workItemScopeGuard } from "@/modules/auth/client-scope";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "resolve");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  const parsed = notAQuestionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "A reason is required: acknowledgement, social, duplicate, or other (with text).", issues: parsed.error.issues.map((i) => i.message) },
      { status: 422 },
    );
  }

  try {
    const { id } = await params;
    const outOfScope = await workItemScopeGuard(auth, id);
    if (outOfScope) return outOfScope;
    const item = await prisma.workItem.findUnique({ where: { id } });
    if (!item) return apiNotFoundError("Work item");
    if (item.kind !== "client_request") {
      return NextResponse.json({ success: false, error: "Only client requests can be closed as 'not a question'." }, { status: 422 });
    }
    if (item.state === "closed") return NextResponse.json({ success: false, error: "Already closed." }, { status: 409 });

    const { reason, text } = parsed.data;
    const transitionName = (await getSetting("intake.jsm.nonQuestionTransition")) || undefined;
    const metadata = (item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata : {}) as Record<string, unknown>;
    const actor = auditActor(auth);
    const updated = await auditedAction(
      {
        action: "work_item_closed_non_actionable",
        entityType: "work_item",
        entityId: id,
        userId: actor.userId,
        summary: `Close client request ${item.ticketKey ?? id} as not a question (${reason})`,
        before: { state: item.state },
        after: { state: "closed", reason, text: text ?? null },
        metadata: actor.metadata,
      },
      async () => {
        await changeState(id, "closed", { transitionName, closure: { nonActionable: { reason } } });
        return prisma.workItem.update({
          where: { id },
          data: {
            rootCause: "no_action_required",
            resolutionNote: `Not a question: ${reason}${text ? ` (${text})` : ""}`,
            metadata: {
              ...metadata,
              closure: { nonActionable: true, reason, text: text ?? null, byUserId: auth.id, at: new Date().toISOString() },
            } as Prisma.InputJsonValue,
          },
        });
      },
      (r) => ({ state: r.state, rootCause: r.rootCause }),
    );
    return apiSuccess(updated);
  } catch (error) {
    if (error instanceof TicketWriteError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    return handleApiError(error, "work-item not-a-question");
  }
}
