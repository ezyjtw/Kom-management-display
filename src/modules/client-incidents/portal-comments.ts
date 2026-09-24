/**
 * Spec §9.7: when the client comments on the portal request, the comment is
 * ingested as a timeline message and restarts the first-response clock.
 * Comments we posted, and comments by internal staff, are ignored.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isAtlassianConfigured, listRequestComments } from "@/lib/integrations/atlassian/client";
import { getSetting } from "@/modules/settings/settings";
import { commentInternal } from "@/modules/work-items/ticket-writeback";

const OPEN = ["open", "owned", "waiting_client", "waiting_vendor", "waiting_internal"] as const;

/** Job `poll_client_ticket_comments` (every 5 minutes). */
export async function ingestPortalComments(now = new Date()): Promise<{ checked: number; newComments: number }> {
  if (!isAtlassianConfigured()) return { checked: 0, newComments: 0 };
  const items = await prisma.workItem.findMany({
    where: { kind: { in: ["client_incident", "client_risk"] }, clientTicketKey: { not: null }, state: { in: [...OPEN] } },
  });
  const internalDomains = (await getSetting("intake.internalEmailDomains")).map((d) => d.toLowerCase());
  let newComments = 0;

  for (const item of items) {
    try {
      const meta = (item.metadata ?? {}) as Record<string, unknown>;
      const ours = new Set(Array.isArray(meta.postedCommentIds) ? (meta.postedCommentIds as string[]) : []);
      const comments = await listRequestComments(item.clientTicketKey!);
      for (const c of comments) {
        if (!c.public || ours.has(c.id)) continue;
        const domain = c.author?.emailAddress?.split("@")[1]?.toLowerCase();
        if (domain && internalDomains.includes(domain)) continue;
        const externalId = `${item.clientTicketKey}:${c.id}`;
        const seen = await prisma.sourceRecord.findUnique({ where: { source_kind_externalId: { source: "jsm", kind: "client_portal_comment", externalId } } });
        if (seen) continue;
        const at = c.created?.iso8601 ? new Date(c.created.iso8601) : now;
        await prisma.sourceRecord.create({
          data: { source: "jsm", kind: "client_portal_comment", externalId, occurredAt: at, fields: { workItemId: item.id, body: c.body.slice(0, 4000) } as Prisma.InputJsonValue },
        });
        // Restart the first-response clock from the client's comment.
        await prisma.workItem.update({
          where: { id: item.id },
          data: { firstResponseAt: null, metadata: { ...meta, firstResponseClockStartedAt: at.toISOString() } as Prisma.InputJsonValue },
        });
        await commentInternal(item.id, `Client commented on the portal request ${item.clientTicketKey}:\n${c.body.slice(0, 2000)}`).catch(() => undefined);
        newComments++;
      }
    } catch (error) {
      logger.warn("Could not read client portal comments", { workItemId: item.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { checked: items.length, newComments };
}
