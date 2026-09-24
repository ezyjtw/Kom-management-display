/**
 * POST /api/work-items/:id/exposure-band — on ALR-OES-06 the operator must
 * choose the client exposure band before the client notification (spec §12
 * CHK-10, CF-39). Recorded on the WorkItem and as a ticket comment; closing
 * the item requires it.
 */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { auditedAction } from "@/lib/api/audit";
import { apiNotFoundError, apiSuccess, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { getSetting } from "@/modules/settings/settings";
import { commentInternal, TicketWriteError } from "@/modules/work-items/ticket-writeback";
import { auditActor } from "@/modules/core-data/audit-actor";
import { workItemScopeGuard } from "@/modules/auth/client-scope";

const bodySchema = z.object({ band: z.string().trim().min(1).max(60) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "update");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Choose an exposure band." }, { status: 422 });

  try {
    const { id } = await params;
    const outOfScope = await workItemScopeGuard(auth, id);
    if (outOfScope) return outOfScope;
    const item = await prisma.workItem.findUnique({ where: { id } });
    if (!item) return apiNotFoundError("Work item");
    const bands = await getSetting("oes.exposureBands");
    // TODO(CONFIRM-EXPOSURE-BANDS): free text until the bands are configured.
    if (bands.length && !bands.includes(parsed.data.band)) {
      return NextResponse.json({ success: false, error: `Exposure band must be one of: ${bands.join(", ")}.` }, { status: 422 });
    }
    const meta = (item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata : {}) as Record<string, unknown>;
    const actor = auditActor(auth);
    const updated = await auditedAction(
      { action: "oes_exposure_band_chosen", entityType: "work_item", entityId: id, userId: actor.userId, summary: `Exposure band ${parsed.data.band}`, after: { band: parsed.data.band }, metadata: actor.metadata },
      async () => {
        if (item.ticketKey) {
          await commentInternal(id, `Client exposure band chosen: ${parsed.data.band}${item.exposureUsd != null ? ` (exposure USD ${item.exposureUsd})` : ""}. See findings register CF-39.`);
        }
        return prisma.workItem.update({
          where: { id },
          data: { metadata: { ...meta, exposureBand: parsed.data.band, exposureBandAt: new Date().toISOString() } as Prisma.InputJsonValue },
        });
      },
    );
    return apiSuccess(updated);
  } catch (error) {
    if (error instanceof TicketWriteError) return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    return handleApiError(error, "exposure band POST");
  }
}
