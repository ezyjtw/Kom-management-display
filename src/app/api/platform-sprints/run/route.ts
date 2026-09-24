/** POST /api/platform-sprints/run { force? } — "Run sprint intake" (spec §16.1), leads and admins; audited fail-closed. */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-user";
import { auditedAction } from "@/lib/api/audit";
import { apiForbiddenError, apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/validation";
import { auditActor } from "@/modules/core-data/audit-actor";
import { runSprintIntake } from "@/modules/platform-sprints/intake";

const bodySchema = z.object({ force: z.boolean().default(false) });

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "admin" && auth.role !== "lead") return apiForbiddenError("Only leads and admins can run the sprint intake");
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.expensive);
  if (limited) return limited;
  try {
    const parsed = validateBody(bodySchema, await request.json().catch(() => ({})));
    if (!parsed.success) return apiValidationError(parsed.error);
    const actor = auditActor(auth);
    const result = await auditedAction(
      { action: "platform_sprint_intake_run", entityType: "platform_sprint", entityId: "all", userId: actor.userId, summary: `Run Platform sprint intake${parsed.data.force ? " (re-read all pages)" : ""}`, metadata: actor.metadata },
      () => runSprintIntake({ force: parsed.data.force }),
      (r) => ({ sprints: r.sprints, newItems: r.newItems, updatedItems: r.updatedItems, removedItems: r.removedItems, ticketsCreated: r.ticketsCreated, ticketsFailed: r.ticketsFailed }),
    );
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error, "platform sprint intake run");
  }
}
