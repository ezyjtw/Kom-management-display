/** GET /api/client-incidents/:id — the entry with its client ticket, client updates and message drafts (spec §9.7). */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiNotFoundError, apiSuccess, handleApiError } from "@/lib/api/response";
import { CLIENT_STATUSES, clientEntryMeta, WITHHELD_BANNER } from "@/modules/client-incidents/service";
import { getSetting } from "@/modules/settings/settings";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "view");
  if (authz instanceof NextResponse) return authz;
  try {
    const { id } = await params;
    const item = await prisma.workItem.findUnique({ where: { id }, include: { client: { select: { displayName: true } } } });
    if (!item || (item.kind !== "client_incident" && item.kind !== "client_risk")) return apiNotFoundError("Client incident or risk");
    const meta = clientEntryMeta(item);
    const [updates, drafts] = await Promise.all([
      prisma.clientUpdate.findMany({ where: { workItemId: id }, orderBy: { createdAt: "asc" } }),
      prisma.outboundMessageDraft.findMany({ where: { workItemId: id }, orderBy: { createdAt: "asc" } }),
    ]);
    const fourEyes = (await getSetting("clientUpdates.requireSecondApprover") as string[]).includes(item.priority);
    return apiSuccess({
      id: item.id,
      kind: item.kind,
      title: item.title,
      client: item.client?.displayName ?? null,
      severity: item.priority,
      state: item.state,
      ticketKey: item.ticketKey,
      ticketUrl: item.ticketUrl,
      clientTicketKey: item.clientTicketKey,
      clientTicketUrl: item.clientTicketUrl,
      sourceMessageRef: item.sourceMessageRef,
      category: meta.category,
      complianceSensitive: meta.complianceSensitive,
      clientFacingSummary: meta.clientFacingSummary,
      internalDescription: meta.internalDescription,
      affectedReferences: meta.affectedReferences,
      clientStatus: meta.clientStatus ?? null,
      lastClientUpdateAt: meta.lastClientUpdateAt ?? null,
      banner: meta.clientTicketBlocked ? WITHHELD_BANNER : null,
      clientTicketError: meta.clientTicketError ?? null,
      complianceDecisionRef: meta.complianceDecisionRef ?? null,
      fourEyes,
      clientStatuses: CLIENT_STATUSES,
      updates: updates.map((u) => ({ id: u.id, body: u.body, kind: u.kind, targetStatus: u.targetStatus, status: u.status, mine: u.authorId === auth.id, postedAt: u.postedAt, createdAt: u.createdAt })),
      drafts: drafts.map((d) => ({ id: d.id, channel: d.channel, body: d.body, status: d.status, purpose: d.purpose, sentAt: d.sentAt })),
    });
  } catch (error) {
    return handleApiError(error, "client-incident GET");
  }
}
