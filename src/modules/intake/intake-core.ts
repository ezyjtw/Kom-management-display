/**
 * Channel-agnostic client intake (spec §9.2 rules, applied to Slack, email and
 * Teams). Rules only; no AI (H3).
 *
 * - Every new root message from an external author opens one JSM request
 *   (write-first: the request is created in JSM before the WorkItem).
 * - A root message from the same author in the same channel within the burst
 *   window is appended to the previous request instead.
 * - A reply adds a comment to the same request; it never opens a new one.
 * - Staff and bot messages never open requests. The first staff reply sets
 *   firstResponseAt and adds an internal comment with the permalink.
 * - Each message is processed at most once (claimed in SourceRecord first).
 */

import { Prisma, type WorkItem } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { browseUrl, createServiceRequest, updateIssueDescription } from "@/lib/integrations/atlassian/client";
import { commentInternal } from "@/modules/work-items/ticket-writeback";
import { getSettings } from "@/modules/settings/settings";
import { clientSlug, derivePriority, summarise } from "@/modules/intake/priority";

export type IntakeChannel = "slack" | "email" | "teams";
export type AuthorKind = "external" | "staff" | "bot";

export interface IntakeClient {
  id: string;
  displayName: string;
  jsmOrganizationId: string | null;
}

export interface IntakeMessage {
  channel: IntakeChannel;
  /** Where the conversation lives (Slack channel id, mailbox label, Teams channel id). Burst merge is per channelKey + author. */
  channelKey: string;
  /** Unique per message; used to process each message once. */
  messageKey: string;
  /** Conversation root (Slack `${channel}:${thread_ts}`, email conversationId, Teams root message). */
  rootKey: string;
  isRoot: boolean;
  author: { kind: AuthorKind; ref: string | null };
  text: string;
  at: Date;
  permalink?: string | null;
  /** null = unknown client (email only), which opens a request tagged client-unknown. */
  client: IntakeClient | null;
  threadId?: string | null;
}

export type IntakeOutcome =
  | "duplicate"
  | "ignored"
  | "created"
  | "merged"
  | "commented"
  | "first_response"
  | "no_request"
  | "not_configured";

const SOURCE = "intake";

/** JSM accepted the request but the WorkItem could not be saved: never retry (that would duplicate the ticket). */
export class RequestNotRecordedError extends Error {
  constructor(readonly issueKey: string, cause: unknown) {
    super(`JSM request ${issueKey} was created but could not be recorded locally: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "RequestNotRecordedError";
  }
}
const OPEN_STATES = ["open", "owned", "waiting_client", "waiting_vendor", "waiting_internal"] as const;

/** Claim a message for processing; false if it was already handled. */
async function claim(messageKey: string): Promise<boolean> {
  try {
    await prisma.sourceRecord.create({ data: { source: SOURCE, kind: "message", externalId: messageKey } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}

async function release(messageKey: string) {
  await prisma.sourceRecord.deleteMany({ where: { source: SOURCE, kind: "message", externalId: messageKey } });
}

export async function findRequestForRoot(channel: IntakeChannel, rootKey: string): Promise<WorkItem | null> {
  return (
    (await prisma.workItem.findUnique({ where: { sourceSystem_sourceId: { sourceSystem: channel, sourceId: rootKey } } })) ??
    (await prisma.workItem.findFirst({
      where: { kind: "client_request", sourceSystem: channel, metadata: { path: ["mergedRootKeys"], array_contains: [rootKey] } },
    }))
  );
}

function meta(item: WorkItem): Record<string, unknown> {
  return item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? (item.metadata as Record<string, unknown>) : {};
}

const withPermalink = (text: string, permalink?: string | null) => (permalink ? `${text}\n\nSource: ${permalink}` : text);

async function createRequest(msg: IntakeMessage, cfg: Awaited<ReturnType<typeof loadConfig>>): Promise<WorkItem> {
  const priority = derivePriority(msg.text, cfg["intake.priorityKeywords"]);
  const labels = [`source-${msg.channel}`, `client-${msg.client ? clientSlug(msg.client.displayName) : "unknown"}`];
  const remote = await createServiceRequest({
    serviceDeskId: cfg["intake.jsm.serviceDeskId"],
    requestTypeId: cfg["intake.jsm.requestTypeId"],
    summary: summarise(msg.text),
    description: withPermalink(msg.text, msg.permalink),
    labels,
    organizationFieldId: cfg["intake.jsm.organizationFieldId"] || undefined,
    organizationId: msg.client?.jsmOrganizationId ?? null,
  });

  try {
    return await recordRequest(msg, remote, priority, labels);
  } catch (error) {
    throw new RequestNotRecordedError(remote.issueKey, error);
  }
}

async function recordRequest(
  msg: IntakeMessage,
  remote: { issueKey: string; _links?: { web?: string } },
  priority: "P1" | "P2",
  labels: string[],
): Promise<WorkItem> {
  const sla = await prisma.slaPolicy.findUnique({ where: { code: `CLIENT-Q-${priority}` }, select: { id: true } });
  const url = remote._links?.web ?? browseUrl(remote.issueKey);
  const item = await prisma.workItem.create({
    data: {
      kind: "client_request",
      title: summarise(msg.text),
      team: "All",
      taskCode: "CLIENT-Q",
      clientId: msg.client?.id ?? null,
      priority,
      sourceSystem: msg.channel,
      sourceId: msg.rootKey,
      ticketSystem: "jsm",
      ticketKey: remote.issueKey,
      ticketUrl: url,
      slaPolicyId: sla?.id ?? null,
      clockStartedAt: msg.at,
      metadata: {
        threadId: msg.threadId ?? null,
        channelKey: msg.channelKey,
        authorRef: msg.author.ref,
        rootKey: msg.rootKey,
        permalink: msg.permalink ?? null,
        labels,
        mergedRootKeys: [],
      } as Prisma.InputJsonValue,
    },
  });
  if (url) {
    await prisma.ticketLink.create({ data: { workItemId: item.id, system: "jsm", key: remote.issueKey, url, role: "primary" } });
  }
  return item;
}

async function loadConfig() {
  return getSettings([
    "intake.jsm.serviceDeskId",
    "intake.jsm.requestTypeId",
    "intake.jsm.organizationFieldId",
    "intake.priorityKeywords",
    "intake.burstMergeSeconds",
  ] as const);
}

/** Open request from the same author in the same channel whose latest root message is within the window. */
async function burstTarget(msg: IntakeMessage, windowSecs: number): Promise<WorkItem | null> {
  if (windowSecs <= 0 || !msg.author.ref) return null;
  const candidates = await prisma.workItem.findMany({
    where: {
      kind: "client_request",
      sourceSystem: msg.channel,
      state: { in: [...OPEN_STATES] },
      clockStartedAt: { gte: new Date(msg.at.getTime() - 24 * 3_600_000), lte: msg.at },
      AND: [
        { metadata: { path: ["channelKey"], equals: msg.channelKey } },
        { metadata: { path: ["authorRef"], equals: msg.author.ref } },
      ],
    },
    orderBy: { clockStartedAt: "desc" },
    take: 5,
  });
  const windowMs = windowSecs * 1000;
  return (
    candidates.find((c) => {
      const last = typeof meta(c).lastRootAt === "string" ? new Date(meta(c).lastRootAt as string) : c.clockStartedAt;
      const gap = msg.at.getTime() - last.getTime();
      return gap >= 0 && gap <= windowMs;
    }) ?? null
  );
}

async function handle(msg: IntakeMessage): Promise<IntakeOutcome> {
  if (msg.isRoot) {
    if (msg.author.kind !== "external") return "ignored";

    const cfg = await loadConfig();
    if (!cfg["intake.jsm.serviceDeskId"] || !cfg["intake.jsm.requestTypeId"]) {
      logger.error("Client intake is on but the JSM service desk / request type is not configured");
      return "not_configured";
    }

    const target = await burstTarget(msg, cfg["intake.burstMergeSeconds"]);
    if (target) {
      await commentInternal(target.id, withPermalink(`Further message from the client (merged):\n${msg.text}`, msg.permalink));
      const merged = Array.isArray(meta(target).mergedRootKeys) ? (meta(target).mergedRootKeys as string[]) : [];
      await prisma.workItem.update({
        where: { id: target.id },
        data: { metadata: { ...meta(target), mergedRootKeys: [...merged, msg.rootKey], lastRootAt: msg.at.toISOString() } as Prisma.InputJsonValue },
      });
      return "merged";
    }

    await createRequest(msg, cfg);
    return "created";
  }

  const request = await findRequestForRoot(msg.channel, msg.rootKey);
  if (!request) return "no_request";

  if (msg.author.kind === "external") {
    await commentInternal(request.id, withPermalink(`Client reply:\n${msg.text}`, msg.permalink));
    return "commented";
  }
  if (msg.author.kind === "staff" && !request.firstResponseAt) {
    await commentInternal(request.id, withPermalink("First Komainu response recorded.", msg.permalink));
    await prisma.workItem.update({ where: { id: request.id }, data: { firstResponseAt: msg.at } });
    return "first_response";
  }
  return "ignored";
}

/** Process one message. Failures release the claim so a retry can try again. */
export async function processIntakeMessage(msg: IntakeMessage): Promise<IntakeOutcome> {
  if (!(await claim(msg.messageKey))) return "duplicate";
  try {
    const outcome = await handle(msg);
    if (outcome === "not_configured") await release(msg.messageKey);
    return outcome;
  } catch (error) {
    if (error instanceof RequestNotRecordedError) {
      logger.error("Client request created in JSM but not recorded; needs manual reconciliation", { issueKey: error.issueKey, messageKey: msg.messageKey });
      await prisma.sourceRecord.update({
        where: { source_kind_externalId: { source: SOURCE, kind: "message", externalId: msg.messageKey } },
        data: { status: "unrecorded_request", fields: { issueKey: error.issueKey } as Prisma.InputJsonValue },
      });
    } else {
      await release(msg.messageKey);
    }
    throw error;
  }
}

/** Spec §9.2 rule 8: an edited root updates the request description; other edits are noted. */
export async function processIntakeEdit(channel: IntakeChannel, rootKey: string, isRoot: boolean, newText: string, at: Date, permalink?: string | null): Promise<IntakeOutcome> {
  const request = await findRequestForRoot(channel, rootKey);
  if (!request?.ticketKey) return "no_request";
  const note = `(edited by the client at ${at.toISOString()})`;
  if (isRoot && request.sourceId === rootKey) {
    await updateIssueDescription(request.ticketKey, withPermalink(`${newText}\n\n${note}`, permalink));
  } else {
    await commentInternal(request.id, withPermalink(`Client edited a message ${note}:\n${newText}`, permalink));
  }
  return "commented";
}

/** Spec §9.2 rule 8: deletes add an internal comment; the request stays for audit. */
export async function processIntakeDelete(channel: IntakeChannel, rootKey: string, at: Date): Promise<IntakeOutcome> {
  const request = await findRequestForRoot(channel, rootKey);
  if (!request?.ticketKey) return "no_request";
  await commentInternal(request.id, `The client deleted a message at ${at.toISOString()}. The request is kept for audit.`);
  return "commented";
}
