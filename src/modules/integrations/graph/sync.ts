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
  listFolderDelta,
  type GraphMailbox,
  type GraphMessage,
} from "@/lib/integrations/graph/client";
import { recordHeartbeat } from "@/modules/integrations/heartbeat";
import { recordPollCycle } from "@/modules/integrations/poll-cycles";
import { upsertSourceRecords } from "@/modules/integrations/source-records";
import { parseVendorEmail, VENDOR_PARSERS, type VendorParser } from "@/modules/integrations/graph/vendor-parsers";
import { handleEmailIntake, handleTeamsIntake } from "@/modules/intake/graph-intake-service";
import { createTicketForWorkItem } from "@/modules/work-items/tickets";

/** Spec §6.1: shared mailboxes are polled every 5 minutes, 24/7. */
export const MAIL_EXPECTED_MINS = 5;
/** On the very first sync of a folder, older mail is skipped (the delta returns the whole folder). */
const FIRST_SYNC_LOOKBACK_MS = 24 * 3_600_000;
export const TEAMS_EXPECTED_MINS = 5;

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

async function alreadyIngested(externalId: string): Promise<boolean> {
  return (await prisma.sourceRecord.count({ where: { source: "graph_mail", kind: "mail_message", externalId } })) > 0;
}

/** Custody inbox: one CommsThread per conversation, one CommsMessage per email (as the IMAP adapter did). */
async function ingestToThread(msg: GraphMessage, queue = "Transaction Operations"): Promise<string> {
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
  return threadId;
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
  const item = await prisma.workItem.upsert({
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
  if (vsr) return "linked" as const;

  // Spec §10.1: a vendor update with no matching VSR opens one.
  if (!item.ticketKey) {
    await createTicketForWorkItem(item.id, {
      projectKey: "VSR",
      summary: `${parsed.vendor} ${parsed.vendorKey}: ${msg.subject ?? ""}`,
      description: `Vendor portal update received by email with no matching VSR.
Vendor: ${parsed.vendor}
Vendor ticket: ${parsed.vendorKey}
Status: ${parsed.status}`,
      labels: ["vendor-update", `vendor-${parsed.vendor.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`],
    });
  }
  return "vsr_created" as const;
}

type StoredMail = Pick<GraphMessage, "id" | "internetMessageId" | "conversationId" | "subject" | "receivedDateTime" | "bodyPreview"> & { fromAddress: string | null; threadId?: string | null };

async function runEmailIntake(mailboxLabel: string, msg: GraphMessage, threadId: string | null, externalId: string) {
  try {
    await handleEmailIntake(mailboxLabel, msg, threadId);
    return true;
  } catch (error) {
    logger.error("Email intake failed; will retry on the next sync", { mailbox: mailboxLabel, error: error instanceof Error ? error.message : String(error) });
    await prisma.sourceRecord.update({
      where: { source_kind_externalId: { source: "graph_mail", kind: "mail_message", externalId } },
      data: { status: "intake_failed" },
    });
    return false;
  }
}

/** Retry client intake for custody messages whose intake failed earlier (e.g. JSM unavailable). */
async function retryFailedIntake(mailboxLabel: string) {
  const failed = await prisma.sourceRecord.findMany({
    where: { source: "graph_mail", kind: "mail_message", status: "intake_failed", fields: { path: ["mailbox"], equals: mailboxLabel } },
    take: 50,
  });
  for (const rec of failed) {
    const stored = (rec.fields as { message?: StoredMail }).message;
    if (!stored) continue;
    const msg: GraphMessage = { ...stored, from: { emailAddress: { address: stored.fromAddress ?? undefined } } };
    if (await runEmailIntake(mailboxLabel, msg, stored.threadId ?? null, rec.externalId)) {
      await prisma.sourceRecord.update({ where: { id: rec.id }, data: { status: "stored" } });
    }
  }
}

/** New messages across the mailbox's folders, via delta queries from the stored cursors. */
async function fetchNewMessages(mailbox: GraphMailbox, now: Date): Promise<GraphMessage[]> {
  const out: GraphMessage[] = [];
  for (const folder of ["inbox", ...(mailbox.folders ?? [])]) {
    const source = `outlook.${mailbox.label}.${folder}`;
    const stored = await prisma.syncCursor.findUnique({ where: { source } });
    const page = await listFolderDelta(mailbox.address, folder, stored?.cursor ?? null);
    const cutoff = stored ? null : new Date(now.getTime() - FIRST_SYNC_LOOKBACK_MS);
    out.push(...page.messages.filter((m) => !m["@removed"] && (!cutoff || !m.receivedDateTime || new Date(m.receivedDateTime) >= cutoff)));
    if (page.cursor) await prisma.syncCursor.upsert({ where: { source }, update: { cursor: page.cursor }, create: { source, cursor: page.cursor } });
  }
  return out.sort((a, b) => (a.receivedDateTime ?? "").localeCompare(b.receivedDateTime ?? ""));
}

export async function syncMailbox(mailbox: GraphMailbox, opts: { parsers?: readonly VendorParser[]; now?: Date } = {}) {
  const hb = `outlook.${mailbox.label}`;
  const now = opts.now ?? new Date();
  const messages = await fetchNewMessages(mailbox, now);
  let ingested = 0;
  let newest: Date | null = null;

  if (mailbox.purpose === "custody") await retryFailedIntake(mailbox.label);

  for (const msg of messages) {
    const externalId = msg.internetMessageId ?? msg.id;
    const at = msg.receivedDateTime ? new Date(msg.receivedDateTime) : null;
    if (at && (!newest || at > newest)) newest = at;
    if (await alreadyIngested(externalId)) continue;
    try {
      let outcome = "stored";
      let threadId: string | null = null;
      if (mailbox.purpose === "custody") threadId = await ingestToThread(msg);
      else if (mailbox.purpose === "vendor_notifications") outcome = await ingestVendorEmail(msg, opts.parsers ?? VENDOR_PARSERS);
      // fab_ics: stored for the FAB rules (TODO(CONFIRM-FAB-TEMPLATES)).
      const stored: StoredMail = {
        id: msg.id,
        internetMessageId: msg.internetMessageId,
        conversationId: msg.conversationId,
        subject: (msg.subject ?? "").slice(0, 300),
        receivedDateTime: msg.receivedDateTime,
        bodyPreview: msg.bodyPreview?.slice(0, 2000),
        fromAddress: msg.from?.emailAddress?.address ?? null,
        threadId,
      };
      await upsertSourceRecords("graph_mail", "mail_message", [{
        externalId,
        status: outcome,
        occurredAt: at,
        fields: {
          mailbox: mailbox.label,
          purpose: mailbox.purpose,
          subject: stored.subject,
          from: stored.fromAddress,
          ...(mailbox.purpose === "custody" ? { message: stored } : {}),
        },
      }]);
      if (mailbox.purpose === "custody") await runEmailIntake(mailbox.label, msg, threadId, externalId);
      ingested++;
    } catch (error) {
      logger.error("Graph mail ingest failed", { mailbox: mailbox.label, error: error instanceof Error ? error.message : String(error) });
    }
  }
  await recordHeartbeat(hb, { count: messages.length, newestRecordAt: newest, expectedEveryMins: MAIL_EXPECTED_MINS });
  return { mailbox: mailbox.label, fetched: messages.length, ingested };
}

/** Job `sync_mail` (every 5 minutes, 24/7; spec §6.1, §8.5). One failing mailbox does not stop the others. */
export async function syncGraphMail() {
  const mailboxes = getMailboxes();
  if (mailboxes.length === 0) return { skipped: true, reason: "No GRAPH_MAILBOXES configured" };
  const results = [];
  let failures = 0;
  for (const mb of mailboxes) {
    const startedAt = new Date();
    try {
      const r = await syncMailbox(mb);
      await recordPollCycle(`outlook.${mb.label}`, startedAt, true, r.fetched, null);
      results.push(r);
    } catch (error) {
      failures++;
      const message = error instanceof Error ? error.message : String(error);
      await recordPollCycle(`outlook.${mb.label}`, startedAt, false, 0, message.slice(0, 300));
      logger.error("Mailbox poll failed; retried next cycle", { mailbox: mb.label, error: message });
    }
  }
  if (failures === mailboxes.length) throw new Error("Mail poll failed for every mailbox");
  return { mailboxes: results, failures };
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
    for (const m of messages) {
      try {
        await handleTeamsIntake(ch.channelId, m);
      } catch (error) {
        logger.error("Teams intake failed", { channel: ch.label, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const newest = messages.reduce<Date | null>((acc, m) => {
      const t = m.createdDateTime ? new Date(m.createdDateTime) : null;
      return t && (!acc || t > acc) ? t : acc;
    }, null);
    await recordHeartbeat(`graph_teams.${ch.label}`, { count: messages.length, newestRecordAt: newest, expectedEveryMins: TEAMS_EXPECTED_MINS });
    total += messages.length;
  }
  return { channels: channels.length, messages: total };
}
