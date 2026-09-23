/**
 * Graph mail and Teams ingestion (spec §8.5). Replaces the IMAP adapter.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { computeTtoDeadline } from "@/lib/sla";
import { normaliseSubject, deriveAutoPriority } from "@/lib/thread-utils";
import type { ThreadPriority } from "@/types";
import {
  getMailboxes,
  getTeamsChannels,
  listChannelMessages,
  listInboxSince,
  type GraphMailbox,
  type GraphMessage,
} from "@/lib/integrations/graph/client";
import { recordHeartbeat } from "@/modules/integrations/heartbeat";
import { upsertSourceRecords } from "@/modules/integrations/source-records";
import { parseVendorEmail, VENDOR_PARSERS, type VendorParser } from "@/modules/integrations/graph/vendor-parsers";

export const MAIL_EXPECTED_MINS = 3;
export const TEAMS_EXPECTED_MINS = 5;

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

async function alreadyIngested(externalId: string): Promise<boolean> {
  return (await prisma.sourceRecord.count({ where: { source: "graph_mail", kind: "mail_message", externalId } })) > 0;
}

/** Custody inbox: one CommsThread per conversation, one CommsMessage per email (as the IMAP adapter did). */
async function ingestToThread(msg: GraphMessage, queue = "Transaction Operations") {
  const from = msg.from?.emailAddress?.address ?? "unknown";
  const at = msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date();
  const body = msg.bodyPreview ?? "";
  const sourceRef = `graph-${msg.conversationId ?? msg.id}`;

  const existing = await prisma.commsThread.findFirst({ where: { sourceThreadRef: sourceRef } });
  const threadId = existing
    ? existing.id
    : (
        await (async () => {
          const priority = deriveAutoPriority({ subject: msg.subject ?? "", body: body.slice(0, 500), senderEmail: from }) ?? ("P2" as ThreadPriority);
          return prisma.commsThread.create({
            data: {
              source: "email",
              sourceThreadRef: sourceRef,
              participants: JSON.stringify([from, ...(msg.toRecipients ?? []).map((r) => r.emailAddress?.address).filter(Boolean)]),
              clientOrPartnerTag: from.split("@")[1] ?? "",
              subject: normaliseSubject(msg.subject ?? "No Subject"),
              priority,
              status: "Unassigned",
              queue,
              lastMessageAt: at,
              ttoDeadline: computeTtoDeadline(at, priority as ThreadPriority),
            },
          });
        })()
      ).id;

  if (existing && at > existing.lastMessageAt) {
    await prisma.commsThread.update({ where: { id: existing.id }, data: { lastMessageAt: at } });
  }
  await prisma.commsMessage.create({
    data: { threadId, authorName: msg.from?.emailAddress?.name || from, authorEmail: from, authorType: "external", bodySnippet: body.slice(0, 2000), timestamp: at },
  });
}

/** Vendor notification: link to the VSR ticket whose title carries the vendor key. */
async function ingestVendorEmail(msg: GraphMessage, parsers: readonly VendorParser[]) {
  const parsed = parseVendorEmail(
    { fromAddress: msg.from?.emailAddress?.address ?? "", subject: msg.subject ?? "", preview: msg.bodyPreview ?? "" },
    parsers,
  );
  if (!parsed) return "unparsed" as const;

  const vsr = await prisma.workItem.findFirst({
    where: { ticketKey: { startsWith: "VSR-" }, title: { contains: parsed.vendorKey } },
    select: { id: true, ticketKey: true },
  });
  const at = msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date();
  await prisma.workItem.upsert({
    where: { sourceSystem_sourceId: { sourceSystem: "email", sourceId: `vendor:${parsed.vendor}:${parsed.vendorKey}` } },
    update: {
      metadata: { vendor: parsed.vendor, vendorKey: parsed.vendorKey, vendorStatus: parsed.status, vsrKey: vsr?.ticketKey ?? null, lastVendorUpdateAt: at.toISOString() } as Prisma.InputJsonValue,
    },
    create: {
      kind: "vendor_ticket",
      title: `${parsed.vendor} ${parsed.vendorKey}: ${msg.subject ?? ""}`.slice(0, 300),
      team: "All",
      taskCode: "VENDOR",
      sourceSystem: "email",
      sourceId: `vendor:${parsed.vendor}:${parsed.vendorKey}`,
      clockStartedAt: at,
      metadata: { vendor: parsed.vendor, vendorKey: parsed.vendorKey, vendorStatus: parsed.status, vsrKey: vsr?.ticketKey ?? null, lastVendorUpdateAt: at.toISOString() } as Prisma.InputJsonValue,
    },
  });
  return "linked" as const;
}

async function lastRecordAt(source: string): Promise<Date | null> {
  return (await prisma.sourceHeartbeat.findUnique({ where: { source } }))?.lastRecordAt ?? null;
}

export async function syncMailbox(mailbox: GraphMailbox, opts: { parsers?: readonly VendorParser[]; now?: Date } = {}) {
  const hb = `graph_mail.${mailbox.label}`;
  const now = opts.now ?? new Date();
  const since = (await lastRecordAt(hb)) ?? new Date(now.getTime() - 24 * 3_600_000);
  const messages = await listInboxSince(mailbox.address, since);
  let ingested = 0;
  let newest: Date | null = null;

  for (const msg of messages) {
    const externalId = msg.internetMessageId ?? msg.id;
    const at = msg.receivedDateTime ? new Date(msg.receivedDateTime) : null;
    if (at && (!newest || at > newest)) newest = at;
    if (await alreadyIngested(externalId)) continue;
    try {
      let outcome = "stored";
      if (mailbox.purpose === "custody") await ingestToThread(msg);
      else if (mailbox.purpose === "vendor_notifications") outcome = await ingestVendorEmail(msg, opts.parsers ?? VENDOR_PARSERS);
      // fab_ics: stored for the FAB rules (TODO(CONFIRM-FAB-TEMPLATES)).
      await upsertSourceRecords("graph_mail", "mail_message", [{
        externalId,
        status: outcome,
        occurredAt: at,
        fields: { mailbox: mailbox.label, purpose: mailbox.purpose, subject: (msg.subject ?? "").slice(0, 300), from: msg.from?.emailAddress?.address ?? null },
      }]);
      ingested++;
    } catch (error) {
      logger.error("Graph mail ingest failed", { mailbox: mailbox.label, error: error instanceof Error ? error.message : String(error) });
    }
  }
  await recordHeartbeat(hb, { count: messages.length, newestRecordAt: newest, expectedEveryMins: MAIL_EXPECTED_MINS });
  return { mailbox: mailbox.label, fetched: messages.length, ingested };
}

export async function syncGraphMail() {
  const mailboxes = getMailboxes();
  if (mailboxes.length === 0) return { skipped: true, reason: "No GRAPH_MAILBOXES configured" };
  const results = [];
  for (const mb of mailboxes) results.push(await syncMailbox(mb));
  return { mailboxes: results };
}

/** Teams channels: internal context only (client messages follow Section 9 in Phase 4). */
export async function syncGraphTeams() {
  const channels = getTeamsChannels();
  if (channels.length === 0) return { skipped: true, reason: "No GRAPH_TEAMS_CHANNELS configured" };
  let total = 0;
  for (const ch of channels) {
    const messages = (await listChannelMessages(ch.teamId, ch.channelId)).filter((m) => (m.messageType ?? "message") === "message");
    await upsertSourceRecords("graph_teams", "teams_message", messages.map((m) => ({
      externalId: `${ch.channelId}:${m.id}`,
      occurredAt: m.createdDateTime ? new Date(m.createdDateTime) : null,
      sourceUpdatedAt: m.lastModifiedDateTime ? new Date(m.lastModifiedDateTime) : null,
      fields: {
        channel: ch.label,
        from: m.from?.user?.displayName ?? m.from?.application?.displayName ?? null,
        text: stripHtml(m.body?.content ?? "").slice(0, 2000),
      },
    })));
    const newest = messages.reduce<Date | null>((acc, m) => {
      const t = m.createdDateTime ? new Date(m.createdDateTime) : null;
      return t && (!acc || t > acc) ? t : acc;
    }, null);
    await recordHeartbeat(`graph_teams.${ch.label}`, { count: messages.length, newestRecordAt: newest, expectedEveryMins: TEAMS_EXPECTED_MINS });
    total += messages.length;
  }
  return { channels: channels.length, messages: total };
}
