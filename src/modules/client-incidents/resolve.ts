/**
 * Resolve the client for a "raise incident / risk" (spec §9.7) from where it
 * was raised: an ingested Slack message, a shared-mailbox email, or an
 * existing WorkItem. It must resolve to exactly one Client with a JSM
 * organisation, otherwise the form blocks ("map this channel or sender to a
 * client first").
 */

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSlackClient } from "@/lib/integrations/slack";

export const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("slack"), channelId: z.string().regex(/^[CGD][A-Z0-9]{6,15}$/), ts: z.string().regex(/^\d{9,11}\.\d{1,6}$/) }),
  z.object({ kind: z.literal("email"), messageRecordId: z.string().min(1).max(500) }),
  z.object({ kind: z.literal("work_item"), workItemId: z.string().min(1).max(100) }),
]);
export type RaiseSource = z.infer<typeof sourceSchema>;

export type ReplyTarget =
  | { channel: "slack"; channelId: string; threadTs: string }
  | { channel: "email"; mailbox: string; messageId: string };

export interface ResolvedSource {
  client: { id: string; displayName: string; jsmOrganizationId: string };
  sourceMessageRef: string | null;
  originWorkItemId: string | null;
  replyTarget: ReplyTarget | null;
}

export class SourceResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceResolutionError";
  }
}

export const UNMAPPED = "Map this channel or sender to a client first (Admin → Clients & Channels), including its JSM organisation.";

async function clientFor(ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length !== 1) throw new SourceResolutionError(UNMAPPED);
  const client = await prisma.client.findUnique({ where: { id: unique[0] }, select: { id: true, displayName: true, jsmOrganizationId: true, isActive: true } });
  if (!client?.isActive || !client.jsmOrganizationId) throw new SourceResolutionError(UNMAPPED);
  return { id: client.id, displayName: client.displayName, jsmOrganizationId: client.jsmOrganizationId };
}

async function slackPermalink(channelId: string, ts: string): Promise<string | null> {
  try {
    return (await getSlackClient()?.chat.getPermalink({ channel: channelId, message_ts: ts }))?.permalink ?? null;
  } catch {
    return null;
  }
}

export async function resolveSource(source: RaiseSource): Promise<ResolvedSource> {
  if (source.kind === "slack") {
    const channel = await prisma.slackChannel.findUnique({ where: { channelId: source.channelId }, select: { id: true, clientId: true } });
    const mapped = await prisma.clientChannel.findMany({ where: { kind: "slack", ref: source.channelId }, select: { clientId: true } });
    const client = await clientFor([channel?.clientId, ...mapped.map((m) => m.clientId)]);
    // Thread root for the reply: the message's own thread (replies carry thread_ts; stored on the CommsMessage).
    const msg = channel
      ? await prisma.commsMessage.findFirst({ where: { slackTs: source.ts, thread: { slackChannelId: channel.id } }, select: { slackThreadTs: true, thread: { select: { slackRootTs: true } } } })
      : null;
    const threadTs = msg?.slackThreadTs ?? msg?.thread?.slackRootTs ?? source.ts;
    const permalink = await slackPermalink(source.channelId, source.ts);
    const origin = await prisma.workItem.findFirst({ where: { kind: "client_request", sourceSystem: "slack", sourceId: `${source.channelId}:${threadTs}` }, select: { id: true } });
    return { client, sourceMessageRef: permalink ?? `slack:${source.channelId}:${source.ts}`, originWorkItemId: origin?.id ?? null, replyTarget: { channel: "slack", channelId: source.channelId, threadTs } };
  }

  if (source.kind === "email") {
    const rec = await prisma.sourceRecord.findFirst({ where: { source: "graph_mail", kind: "mail_message", externalId: source.messageRecordId } });
    if (!rec) throw new SourceResolutionError("Email not found.");
    const f = (rec.fields ?? {}) as { from?: string; mailbox?: string; message?: { id?: string; conversationId?: string } };
    const domain = f.from?.split("@")[1]?.toLowerCase();
    const mapped = domain ? await prisma.clientChannel.findMany({ where: { kind: "email_domain", ref: domain }, select: { clientId: true } }) : [];
    const client = await clientFor(mapped.map((m) => m.clientId));
    const origin = f.message?.conversationId
      ? await prisma.workItem.findFirst({ where: { kind: "client_request", sourceSystem: "email", sourceId: f.message.conversationId }, select: { id: true } })
      : null;
    return {
      client,
      sourceMessageRef: f.message?.id ?? rec.externalId,
      originWorkItemId: origin?.id ?? null,
      replyTarget: f.message?.id && f.mailbox ? { channel: "email", mailbox: f.mailbox, messageId: f.message.id } : null,
    };
  }

  const item = await prisma.workItem.findUnique({ where: { id: source.workItemId }, select: { id: true, clientId: true, sourceSystem: true, sourceId: true, metadata: true } });
  if (!item) throw new SourceResolutionError("Work item not found.");
  const client = await clientFor([item.clientId]);
  const meta = (item.metadata ?? {}) as Record<string, unknown>;
  let replyTarget: ReplyTarget | null = null;
  if (item.sourceSystem === "slack") {
    const [channelId, threadTs] = item.sourceId.split(":");
    if (channelId && threadTs) replyTarget = { channel: "slack", channelId, threadTs };
  }
  return { client, sourceMessageRef: typeof meta.permalink === "string" ? meta.permalink : null, originWorkItemId: item.id, replyTarget };
}
