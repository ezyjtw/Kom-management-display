/**
 * "First response" quick action (spec §14.4): a human-written reply into the
 * client's Slack thread or email, optionally starting from a template. AI is
 * not used. The reply is checked like any client-visible text (H12), sent
 * only by the operator's explicit action, and stops the first-response clock.
 */

import { z } from "zod";
import type { Prisma, WorkItem } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { emitWorkItemUpdate } from "@/lib/sse";
import { getSetting } from "@/modules/settings/settings";
import { ClientIncidentError, sendDraft, type Actor } from "@/modules/client-incidents/service";
import type { ReplyTarget } from "@/modules/client-incidents/resolve";

export const firstResponseSchema = z.object({
  body: z.string().trim().min(5).max(4000),
  markSentManually: z.boolean().default(false),
});

/** Where a reply to this item goes, or null when it did not come from Slack or email. */
export async function replyTargetFor(item: Pick<WorkItem, "sourceSystem" | "sourceId">): Promise<ReplyTarget | null> {
  if (item.sourceSystem === "slack") {
    const [channelId, threadTs] = item.sourceId.split(":");
    return channelId && threadTs ? { channel: "slack", channelId, threadTs } : null;
  }
  if (item.sourceSystem === "email") {
    const recs = await prisma.sourceRecord.findMany({ where: { source: "graph_mail", kind: "mail_message" }, orderBy: { occurredAt: "desc" }, take: 500 });
    const rec = recs.find((r) => ((r.fields ?? {}) as { message?: { conversationId?: string } }).message?.conversationId === item.sourceId);
    const f = (rec?.fields ?? {}) as { mailbox?: string; message?: { id?: string } };
    return f.mailbox && f.message?.id ? { channel: "email", mailbox: f.mailbox, messageId: f.message.id } : null;
  }
  return null;
}

/** Templates with {ticket} filled in. */
export async function firstResponseTemplates(item: Pick<WorkItem, "ticketKey">): Promise<string[]> {
  const templates = await getSetting("workItem.firstResponseTemplates");
  return templates.map((t) => t.replaceAll("{ticket}", item.ticketKey ?? "your request"));
}

export async function sendFirstResponse(id: string, input: z.infer<typeof firstResponseSchema>, actor: Actor) {
  const item = await prisma.workItem.findUnique({ where: { id } });
  if (!item) throw new ClientIncidentError("Work item not found.", 404);
  if (item.kind !== "client_request") throw new ClientIncidentError("First response is for client requests.", 409);
  if (!item.clientId) throw new ClientIncidentError("Map this channel or sender to a client first, so the reply can be checked against other clients.", 409);
  const target = await replyTargetFor(item);
  if (!target) throw new ClientIncidentError("This request did not come from a Slack thread or an email that can be replied to.", 409);

  const draft = await prisma.outboundMessageDraft.create({
    data: { workItemId: id, channel: target.channel, target: target as unknown as Prisma.InputJsonValue, body: input.body, purpose: "first_response" },
  });
  try {
    const sent = await sendDraft(draft.id, input.body, actor, { markSentManually: input.markSentManually });
    const updated = item.firstResponseAt ? item : await prisma.workItem.update({ where: { id }, data: { firstResponseAt: sent.sentAt ?? new Date() } });
    emitWorkItemUpdate({ workItemId: id, team: item.team, change: "first_response", priority: item.priority, kind: item.kind });
    return { draftId: draft.id, sentVia: (sent.target as { sentVia?: string }).sentVia ?? null, firstResponseAt: updated.firstResponseAt?.toISOString() ?? null };
  } catch (error) {
    await prisma.outboundMessageDraft.update({ where: { id: draft.id }, data: { status: "discarded" } }).catch(() => undefined);
    throw error;
  }
}
