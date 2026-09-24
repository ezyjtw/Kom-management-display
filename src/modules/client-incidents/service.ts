/**
 * Raise an incident or risk from a message (spec §9.7, H12).
 *
 * Two linked records: an internal entry (WorkItem + internal Jira ticket) for
 * the team, and a client-specific JSM request the client follows in the portal.
 * Client-visible content is human-written and client-scoped; nothing
 * client-visible is posted automatically. Compliance-sensitive categories
 * never create a client request without a recorded Compliance decision.
 */

import { Prisma, type WorkItem } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  addRequestComment, browseUrl, createServiceRequest, isAtlassianConfigured, listOrganizationCustomers,
  listRequestTransitions, performRequestTransition,
} from "@/lib/integrations/atlassian/client";
import { getSlackClient } from "@/lib/integrations/slack";
import { replyToMessage } from "@/lib/integrations/graph/client";
import { getMailboxes } from "@/lib/integrations/graph/client";
import { getSettings, getSetting } from "@/modules/settings/settings";
import { ensureTicketedWorkItem } from "@/modules/work-items/tickets";
import { commentInternal } from "@/modules/work-items/ticket-writeback";
import { createIaiDraft } from "@/modules/iai/drafts";
import { raiseAlert } from "@/modules/alerting/raise";
import { assertClientVisible } from "@/modules/client-incidents/guards";
import { canSeeClient, clientScopeFor } from "@/modules/auth/client-scope";
import { resolveSource, sourceSchema, type ReplyTarget } from "@/modules/client-incidents/resolve";

export const CLIENT_STATUSES = ["Received", "Investigating", "Update provided", "Resolved"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];
export const WITHHELD_BANNER = "Client ticket withheld pending Compliance decision (tipping-off risk)";
export const NO_PORTAL_USERS = "No portal users for this client: they cannot view the ticket until IT or Admin Operations add them (CONFIRM-JSM-PORTAL).";

export const raiseSchema = z.object({
  type: z.enum(["incident", "risk"]),
  source: sourceSchema,
  severity: z.enum(["P0", "P1", "P2", "P3"]),
  category: z.string().regex(/^[a-z_]{2,40}$/),
  clientFacingSummary: z.string().trim().min(10).max(1000),
  internalDescription: z.string().trim().min(10).max(10_000),
  affectedReferences: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  notifyClientNow: z.boolean().optional(),
});
export type RaiseInput = z.infer<typeof raiseSchema>;

export class ClientIncidentError extends Error {
  constructor(message: string, readonly status: 404 | 409 | 422 = 422) {
    super(message);
    this.name = "ClientIncidentError";
  }
}

export interface Actor {
  userId: string;
  employeeId: string | null;
  role: string;
}

interface Meta {
  type: "incident" | "risk";
  category: string;
  complianceSensitive: boolean;
  clientFacingSummary: string;
  internalDescription: string;
  affectedReferences: string[];
  originWorkItemId: string | null;
  replyTarget: ReplyTarget | null;
  raisedByUserId: string;
  clientTicketBlocked?: "compliance_sensitive";
  complianceDecisionRef?: string;
  clientTicketError?: string;
  lastClientUpdateAt?: string;
  clientTicketCreatedAt?: string;
  clientStatus?: ClientStatus;
  postedCommentIds?: string[];
  [k: string]: unknown;
}

const metaOf = (item: Pick<WorkItem, "metadata">) => (item.metadata ?? {}) as unknown as Meta;
const title = (type: "incident" | "risk", summary: string) => `${type === "incident" ? "Incident" : "Risk"}: ${summary.slice(0, 80)}`;

/** Portal users in the client's JSM organisation, or null when that cannot be read. */
export async function portalUsers(organizationId: string): Promise<{ accountId: string }[] | null> {
  if (!isAtlassianConfigured()) return null;
  try {
    return await listOrganizationCustomers(organizationId);
  } catch (error) {
    logger.warn("Could not read JSM organisation customers", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

async function clientTicketConfig() {
  const cfg = await getSettings(["intake.jsm.serviceDeskId", "clientIncidents.jsmRequestTypeId", "intake.jsm.organizationFieldId"] as const);
  if (!cfg["intake.jsm.serviceDeskId"] || !cfg["clientIncidents.jsmRequestTypeId"]) {
    throw new ClientIncidentError("The JSM service desk and incident/risk request type are not configured (CONFIRM-JSM-INCIDENT-REQUEST-TYPE). No client request was created.");
  }
  return cfg;
}

/**
 * Create the client-specific JSM request. Cross-client safety checks run first:
 * the organisation is the resolved client's; participants all belong to it;
 * the text names no other client and carries no internal description.
 */
async function createClientRequest(item: WorkItem): Promise<{ key: string; url: string | null; portalUsers: number | null }> {
  const meta = metaOf(item);
  if (!item.clientId) throw new ClientIncidentError("The entry has no client.");
  const client = await prisma.client.findUnique({ where: { id: item.clientId }, select: { id: true, jsmOrganizationId: true } });
  if (!client?.jsmOrganizationId) throw new ClientIncidentError("The client has no JSM organisation.");
  const cfg = await clientTicketConfig();
  await assertClientVisible(meta.clientFacingSummary, client.id, meta.internalDescription);

  // TODO(CONFIRM-CLIENT-CONTACTS): participants are the client's ClientChannel rows of kind jsm_participant.
  const participants = (await prisma.clientChannel.findMany({ where: { clientId: client.id, kind: "jsm_participant" }, select: { ref: true } })).map((p) => p.ref);
  const users = await portalUsers(client.jsmOrganizationId);
  if (participants.length) {
    if (!users) throw new ClientIncidentError("Cannot verify that the request participants belong to the client's organisation; no request was created.", 409);
    const members = new Set(users.map((u) => u.accountId));
    const outside = participants.filter((p) => !members.has(p));
    if (outside.length) throw new ClientIncidentError(`${outside.length} request participant(s) are not in this client's JSM organisation; no request was created.`);
  }

  const created = await createServiceRequest({
    serviceDeskId: cfg["intake.jsm.serviceDeskId"],
    requestTypeId: cfg["clientIncidents.jsmRequestTypeId"],
    summary: title(meta.type, meta.clientFacingSummary),
    description: meta.clientFacingSummary,
    labels: [`client-${meta.type}`],
    organizationFieldId: cfg["intake.jsm.organizationFieldId"] || undefined,
    organizationId: client.jsmOrganizationId,
    requestParticipants: participants,
  });
  const url = created._links?.web ?? browseUrl(created.issueKey);
  await prisma.$transaction([
    prisma.workItem.update({
      where: { id: item.id },
      data: {
        clientTicketKey: created.issueKey,
        clientTicketUrl: url,
        metadata: { ...meta, clientTicketError: undefined, clientStatus: "Received", clientTicketCreatedAt: new Date().toISOString(), lastClientUpdateAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
      },
    }),
    ...(url ? [prisma.ticketLink.create({ data: { workItemId: item.id, system: "jsm", key: created.issueKey, url, role: "client" } })] : []),
  ]);
  return { key: created.issueKey, url, portalUsers: users ? users.length : null };
}

async function notifyDraft(item: WorkItem, key: string, url: string | null) {
  const target = metaOf(item).replyTarget;
  if (!target || !url) return null;
  const template = await getSetting("clientIncidents.notifyTemplate");
  return prisma.outboundMessageDraft.create({
    data: {
      workItemId: item.id,
      channel: target.channel,
      target: target as unknown as Prisma.InputJsonValue,
      body: template.replace("{key}", key).replace("{link}", url),
      purpose: "client_ticket_link",
    },
  });
}

export interface RaiseResult {
  workItem: WorkItem;
  clientTicket: { key: string; url: string | null } | null;
  withheld: boolean;
  draftId: string | null;
  warnings: string[];
}

export async function raiseClientEntry(input: RaiseInput, actor: Actor): Promise<RaiseResult> {
  const category = await prisma.incidentCategory.findUnique({ where: { code: input.category } });
  if (!category?.isActive) throw new ClientIncidentError("Unknown or inactive category.");
  const sensitive = category.complianceSensitive;
  const resolved = await resolveSource(input.source);
  // Client isolation (spec §17.5): a user may only raise for a client in their scope.
  if (!canSeeClient(await clientScopeFor({ id: actor.userId, role: actor.role }), resolved.client.id)) {
    throw new ClientIncidentError("Source not found.", 404);
  }

  // Client-visible text is checked before anything is created (H12).
  await assertClientVisible(input.clientFacingSummary, resolved.client.id, input.internalDescription);
  if (!sensitive) await clientTicketConfig();

  const internalProject = await getSetting("clientIncidents.internalProject");
  const origin = resolved.originWorkItemId ? await prisma.workItem.findUnique({ where: { id: resolved.originWorkItemId }, select: { id: true, ticketKey: true, ticketSystem: true, ticketUrl: true } }) : null;
  const meta: Meta = {
    type: input.type,
    category: input.category,
    complianceSensitive: sensitive,
    clientFacingSummary: input.clientFacingSummary,
    internalDescription: input.internalDescription,
    affectedReferences: input.affectedReferences,
    originWorkItemId: origin?.id ?? null,
    replyTarget: resolved.replyTarget,
    raisedByUserId: actor.userId,
    ...(sensitive ? { clientTicketBlocked: "compliance_sensitive" as const } : {}),
  };

  const item = await ensureTicketedWorkItem({
    kind: input.type === "incident" ? "client_incident" : "client_risk",
    title: `${resolved.client.displayName} — ${title(input.type, input.clientFacingSummary)}`,
    team: "All",
    taskCode: input.type === "incident" ? "CLIENT-INCIDENT" : "CLIENT-RISK",
    sourceSystem: "client_entry",
    sourceId: `${input.type}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
    clockStartedAt: new Date(),
    priority: input.severity,
    clientId: resolved.client.id,
    metadata: meta,
    slaPolicyCode: "CLIENT-INCIDENT-UPDATE",
    ticket: {
      projectKey: internalProject,
      summary: `[${input.severity}] ${resolved.client.displayName}: ${title(input.type, input.clientFacingSummary)}`,
      description: [
        `Client ${input.type} raised in KOMmand Centre (internal record; the client never sees this ticket).`,
        `Category: ${category.label}${sensitive ? " (compliance-sensitive: client ticket withheld)" : ""}`,
        `Source: ${resolved.sourceMessageRef ?? "n/a"}`,
        `Internal description:\n${input.internalDescription}`,
        input.affectedReferences.length ? `Affected references (internal only):\n${input.affectedReferences.join("\n")}` : "",
        origin?.ticketKey ? `Raised from ${origin.ticketKey}` : "",
      ].filter(Boolean).join("\n\n"),
      labels: [`client-${input.type}`, `category-${input.category.replace(/_/g, "-")}`],
    },
  });
  await prisma.workItem.update({ where: { id: item.id }, data: { sourceMessageRef: resolved.sourceMessageRef } });
  if (origin?.ticketKey && origin.ticketUrl) {
    await prisma.ticketLink.create({ data: { workItemId: item.id, system: origin.ticketSystem ?? "jira", key: origin.ticketKey, url: origin.ticketUrl, role: "related" } }).catch(() => undefined);
  }

  const iaiCategories = await getSetting("clientIncidents.iaiCategories");
  if (iaiCategories.includes(input.category)) await createIaiDraft(item.id, `CLIENT-${input.type.toUpperCase()}`).catch(() => null);

  const critical = input.severity === "P0" || input.severity === "P1";
  await raiseAlert({
    ruleCode: "ALR-CLI-01",
    dedupeKey: item.id,
    message: `Client ${input.type} raised: ${resolved.client.displayName} (${input.severity})`,
    severity: critical ? "critical" : "high",
    priority: input.severity,
    workItemId: item.id,
  });

  const warnings: string[] = [];
  if (sensitive) {
    await raiseAlert({
      ruleCode: "ALR-CLI-03",
      dedupeKey: item.id,
      message: `Compliance-sensitive ${input.type} raised (${category.label}); client ticket withheld pending a Compliance decision.`,
      severity: "critical",
      priority: input.severity,
      workItemId: item.id,
    });
    const fresh = (await prisma.workItem.findUnique({ where: { id: item.id } }))!;
    return { workItem: fresh, clientTicket: null, withheld: true, draftId: null, warnings: [WITHHELD_BANNER] };
  }

  let clientTicket: RaiseResult["clientTicket"] = null;
  let draftId: string | null = null;
  try {
    const created = await createClientRequest((await prisma.workItem.findUnique({ where: { id: item.id } }))!);
    clientTicket = { key: created.key, url: created.url };
    if (created.portalUsers === 0) warnings.push(NO_PORTAL_USERS);
    if (input.notifyClientNow !== false) draftId = (await notifyDraft((await prisma.workItem.findUnique({ where: { id: item.id } }))!, created.key, created.url))?.id ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("Client request not created; internal entry kept", { workItemId: item.id, error: message });
    const current = (await prisma.workItem.findUnique({ where: { id: item.id } }))!;
    await prisma.workItem.update({ where: { id: item.id }, data: { metadata: { ...metaOf(current), clientTicketError: message.slice(0, 500) } as unknown as Prisma.InputJsonValue } });
    warnings.push(`The client request was not created: ${message}`);
  }
  const fresh = (await prisma.workItem.findUnique({ where: { id: item.id } }))!;
  return { workItem: fresh, clientTicket, withheld: false, draftId, warnings };
}

async function loadEntry(id: string): Promise<WorkItem> {
  const item = await prisma.workItem.findUnique({ where: { id } });
  if (!item || (item.kind !== "client_incident" && item.kind !== "client_risk")) throw new ClientIncidentError("Client incident or risk not found.", 404);
  return item;
}

/** Retry the client request after a failure (not for withheld, compliance-sensitive entries). */
export async function retryClientRequest(id: string) {
  const item = await loadEntry(id);
  if (item.clientTicketKey) throw new ClientIncidentError("The client request already exists.", 409);
  if (metaOf(item).clientTicketBlocked) throw new ClientIncidentError("This entry is compliance-sensitive: an admin must record the Compliance decision first.", 409);
  return createClientRequest(item);
}

/** Admin only: create the withheld client request after recording the Compliance decision (audit-logged by the route). */
export async function releaseWithheldClientRequest(id: string, complianceDecisionRef: string, actor: Actor) {
  if (actor.role !== "admin") throw new ClientIncidentError("Only an admin can create a withheld client request.", 422);
  if (!complianceDecisionRef.trim()) throw new ClientIncidentError("A Compliance decision reference is required.");
  const item = await loadEntry(id);
  if (item.clientTicketKey) throw new ClientIncidentError("The client request already exists.", 409);
  const meta = metaOf(item);
  if (meta.clientTicketBlocked !== "compliance_sensitive") throw new ClientIncidentError("This entry is not withheld.", 409);
  const released = await prisma.workItem.update({
    where: { id },
    data: { metadata: { ...meta, clientTicketBlocked: undefined, complianceDecisionRef: complianceDecisionRef.trim() } as unknown as Prisma.InputJsonValue },
  });
  return createClientRequest(released);
}

async function transitionClient(item: WorkItem, status: ClientStatus) {
  const names = await getSetting("clientIncidents.statusNames");
  const transitions = await listRequestTransitions(item.clientTicketKey!);
  const t = transitions.find((x) => x.name === names[status]);
  if (!t) throw new ClientIncidentError(`The client request cannot move to "${status}" from its current status.`, 409);
  await performRequestTransition(item.clientTicketKey!, t.id);
}

/** Move the client request through the four client-visible statuses only. */
export async function setClientStatus(id: string, status: string): Promise<WorkItem> {
  if (!(CLIENT_STATUSES as readonly string[]).includes(status)) {
    throw new ClientIncidentError(`Client-visible status must be one of: ${CLIENT_STATUSES.join(", ")}.`);
  }
  const item = await loadEntry(id);
  if (!item.clientTicketKey) throw new ClientIncidentError("This entry has no client request.", 409);
  if (status === "Resolved" && item.state !== "closed") throw new ClientIncidentError("Resolved is set when the entry is closed with the client resolution message.", 409);
  await transitionClient(item, status as ClientStatus);
  return prisma.workItem.update({ where: { id }, data: { metadata: { ...metaOf(item), clientStatus: status } as unknown as Prisma.InputJsonValue } });
}

async function publish(item: WorkItem, body: string, targetStatus: ClientStatus | null, kind: "update" | "resolution") {
  const meta = metaOf(item);
  await assertClientVisible(body, item.clientId!, meta.internalDescription);
  const posted = await addRequestComment(item.clientTicketKey!, body, { public: true });
  if (targetStatus) await transitionClient(item, targetStatus);
  await commentInternal(item.id, `[Client ${kind} posted to ${item.clientTicketKey}]\n${body}`).catch((error) =>
    logger.warn("Could not mirror the client update internally", { error: error instanceof Error ? error.message : String(error) }),
  );
  const next: Meta = { ...meta, lastClientUpdateAt: new Date().toISOString(), postedCommentIds: [...(meta.postedCommentIds ?? []), posted.id], ...(targetStatus ? { clientStatus: targetStatus } : {}) };
  await prisma.workItem.update({ where: { id: item.id }, data: { metadata: next as unknown as Prisma.InputJsonValue } });
}

export const updateSchema = z.object({
  body: z.string().trim().min(5).max(2000),
  targetStatus: z.enum(["Investigating", "Update provided"]).optional(),
});

/**
 * "Post client update": human-written. Severities in
 * clientUpdates.requireSecondApprover wait for a second team member.
 */
export async function postClientUpdate(id: string, input: z.infer<typeof updateSchema>, actor: Actor) {
  const item = await loadEntry(id);
  if (!item.clientTicketKey) throw new ClientIncidentError("This entry has no client request.", 409);
  if (item.state === "closed") throw new ClientIncidentError("The entry is closed.", 409);
  await assertClientVisible(input.body, item.clientId!, metaOf(item).internalDescription);
  const needsApproval = (await getSetting("clientUpdates.requireSecondApprover") as string[]).includes(item.priority);
  const update = await prisma.clientUpdate.create({
    data: { workItemId: id, body: input.body, targetStatus: input.targetStatus ?? null, authorId: actor.userId, status: needsApproval ? "pending_approval" : "posted", postedAt: needsApproval ? null : new Date() },
  });
  if (!needsApproval) {
    try {
      await publish(item, input.body, input.targetStatus ?? null, "update");
    } catch (error) {
      await prisma.clientUpdate.update({ where: { id: update.id }, data: { status: "pending_approval", postedAt: null } });
      throw error;
    }
  }
  return prisma.clientUpdate.findUnique({ where: { id: update.id } });
}

/** Four-eyes (spec §9.7): a different team member approves; the update is then posted. Not a transaction approval. */
export async function approveClientUpdate(id: string, updateId: string, actor: Actor) {
  const item = await loadEntry(id);
  const update = await prisma.clientUpdate.findUnique({ where: { id: updateId } });
  if (!update || update.workItemId !== id) throw new ClientIncidentError("Update not found.", 404);
  if (update.status !== "pending_approval") throw new ClientIncidentError(`The update is already ${update.status}.`, 409);
  if (update.authorId === actor.userId) throw new ClientIncidentError("A second team member must approve this update: the writer cannot approve their own.");
  await publish(item, update.body, (update.targetStatus as ClientStatus | null) ?? null, "update");
  return prisma.clientUpdate.update({ where: { id: updateId }, data: { status: "posted", approverId: actor.userId, postedAt: new Date() } });
}

/** Called before the internal close: posts the human-written resolution message and moves the client request to Resolved. */
export async function publishResolution(item: WorkItem, message: string, actor: Actor) {
  await publish(item, message, "Resolved", "resolution");
  await prisma.clientUpdate.create({ data: { workItemId: item.id, body: message, kind: "resolution", targetStatus: "Resolved", authorId: actor.userId, status: "posted", postedAt: new Date() } });
}

/** Send a drafted client message. Only on an explicit operator action; the body is re-checked (H12). */
export async function sendDraft(draftId: string, body: string, actor: Actor, opts: { markSentManually?: boolean } = {}) {
  const draft = await prisma.outboundMessageDraft.findUnique({ where: { id: draftId } });
  if (!draft || draft.status !== "draft") throw new ClientIncidentError("Draft not found or already handled.", 404);
  const item = await prisma.workItem.findUnique({ where: { id: draft.workItemId } });
  if (!item?.clientId) throw new ClientIncidentError("The draft's work item has no client.", 409);
  const text = body.trim();
  if (text.length < 5 || text.length > 4000) throw new ClientIncidentError("The message must be 5 to 4,000 characters.");
  await assertClientVisible(text, item.clientId, metaOf(item).internalDescription);

  const target = draft.target as unknown as ReplyTarget;
  let via = "manual";
  if (!opts.markSentManually) {
    if (target.channel === "slack") {
      const slack = getSlackClient();
      if (!slack) throw new ClientIncidentError("Slack is not configured.", 409);
      await slack.chat.postMessage({ channel: target.channelId, thread_ts: target.threadTs, text });
      via = "slack";
    } else {
      if (!(await getSetting("clientIncidents.emailReplyEnabled"))) {
        throw new ClientIncidentError("Email sending is not enabled (CONFIRM-GRAPH-MAIL-SEND). Send the reply from Outlook, then mark it as sent.", 409);
      }
      const mailbox = getMailboxes().find((m) => m.label === target.mailbox);
      if (!mailbox) throw new ClientIncidentError("The mailbox is not configured.", 409);
      await replyToMessage(mailbox.address, target.messageId, text);
      via = "email";
    }
  }
  return prisma.outboundMessageDraft.update({ where: { id: draftId }, data: { body: text, status: "sent", sentById: actor.userId, sentAt: new Date(), target: { ...target, sentVia: via } as unknown as Prisma.InputJsonValue } });
}

export { metaOf as clientEntryMeta };
