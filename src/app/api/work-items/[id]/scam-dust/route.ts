/**
 * POST /api/work-items/:id/scam-dust — structured fields for a scam/dust case
 * (spec §12 CHK-06): the client advisory, a client override with the client's
 * decision attached (CF-35), and the "possible false positive" flag, which
 * opens a ticket to Tech (CF-34: GX auto-blacklists dust senders with no
 * documented reversal path). Nothing is changed in GX.
 */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { auditedAction } from "@/lib/api/audit";
import { apiNotFoundError, apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/validation";
import { getSetting } from "@/modules/settings/settings";
import { ensureTicketedWorkItem } from "@/modules/work-items/tickets";
import { auditActor } from "@/modules/core-data/audit-actor";

const bodySchema = z.object({
  clientAdvisory: z.string().trim().min(3).max(2000).optional(),
  clientOverride: z.boolean().optional(),
  clientDecisionUrl: z.string().url().max(500).optional(),
  possibleFalsePositive: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, "No changes");

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "update");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;
  try {
    const { id } = await params;
    const parsed = validateBody(bodySchema, await request.json());
    if (!parsed.success) return apiValidationError(parsed.error);
    const item = await prisma.workItem.findUnique({ where: { id } });
    if (!item) return apiNotFoundError("Work item");
    if (item.kind !== "scam_dust_case") return NextResponse.json({ success: false, error: "Only scam/dust cases have these fields." }, { status: 422 });

    const meta = (item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata : {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...meta, ...parsed.data };
    const actor = auditActor(auth);
    const updated = await auditedAction(
      { action: "scam_dust_case_updated", entityType: "work_item", entityId: id, userId: actor.userId, summary: `Update scam/dust case ${item.ticketKey ?? id}`, after: parsed.data, metadata: actor.metadata },
      async () => {
        if (parsed.data.possibleFalsePositive && !meta.falsePositiveWorkItemId) {
          const project = await getSetting("scamDust.techProject");
          const fp = await ensureTicketedWorkItem({
            kind: "internal_task",
            title: `Possible false positive (dust blacklist): ${item.title}`,
            team: item.team,
            taskCode: "CHK-06",
            sourceSystem: "scam_dust_fp",
            sourceId: item.id,
            clockStartedAt: new Date(),
            metadata: { scamDustWorkItemId: item.id },
            ticket: project
              ? { projectKey: project, summary: `Possible false positive: ${item.title}`, description: `Operations flagged a possible false positive on ${item.ticketKey ?? item.id}. GX auto-blacklists dust senders with no documented reversal path (findings register CF-34).`, labels: ["scam-dust", "false-positive"] }
              : null,
          });
          next.falsePositiveWorkItemId = fp.id;
        }
        return prisma.workItem.update({ where: { id }, data: { metadata: next as Prisma.InputJsonValue } });
      },
      () => ({ falsePositiveWorkItemId: (next.falsePositiveWorkItemId as string | undefined) ?? null }),
    );
    return apiSuccess(updated);
  } catch (error) {
    return handleApiError(error, "scam-dust POST");
  }
}
