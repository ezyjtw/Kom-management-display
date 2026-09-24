/**
 * Work item detail (spec §14.2): header plus one timeline of source messages
 * (with permalinks and "raise incident / risk" links), ticket comments,
 * alerts, SLA events, client updates and recorded changes.
 */

import type { WorkItem } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { adfToText, isAtlassianConfigured, listIssueComments, listRequestComments } from "@/lib/integrations/atlassian/client";
import { loadCalendar } from "@/modules/alerting/calendar";
import { slaStatus, type SlaStatus } from "@/modules/work-items/queue";
import { getSettings } from "@/modules/settings/settings";
import { TIME_LOG_BUCKETS } from "@/modules/work-items/closure-rules";
import { firstResponseTemplates, replyTargetFor } from "@/modules/work-items/first-response";

export type TimelineKind = "message" | "ticket_comment" | "alert" | "sla" | "client_update" | "change";

export interface TimelineEntry {
  at: string;
  kind: TimelineKind;
  title: string;
  text: string;
  author: string | null;
  link: string | null;
  /** Deep link to raise an incident / risk from this message (spec §9.7). */
  raiseLink: string | null;
  internal?: boolean;
}

const raiseSlack = (channelId: string, ts: string) => `/client-incidents/new?kind=slack&channelId=${encodeURIComponent(channelId)}&ts=${encodeURIComponent(ts)}`;
const raiseEmail = (id: string) => `/client-incidents/new?kind=email&messageRecordId=${encodeURIComponent(id)}`;

async function sourceMessages(item: WorkItem): Promise<TimelineEntry[]> {
  if (item.sourceSystem === "slack") {
    const [channelId, rootTs] = item.sourceId.split(":");
    if (!channelId || !rootTs) return [];
    const channel = await prisma.slackChannel.findUnique({ where: { channelId }, select: { id: true } });
    if (!channel) return [];
    const thread = await prisma.commsThread.findFirst({ where: { slackChannelId: channel.id, slackRootTs: rootTs }, select: { id: true } });
    if (!thread) return [];
    const messages = await prisma.commsMessage.findMany({ where: { threadId: thread.id }, orderBy: { timestamp: "asc" }, take: 200 });
    return messages.map((m) => ({
      at: m.timestamp.toISOString(),
      kind: "message" as const,
      title: `Slack · ${m.authorType === "external" ? "client" : "internal"}`,
      text: m.bodySnippet,
      author: m.authorName,
      link: m.bodyLink || null,
      raiseLink: m.slackTs ? raiseSlack(channelId, m.slackTs) : null,
    }));
  }
  if (item.sourceSystem === "email") {
    const recs = await prisma.sourceRecord.findMany({
      where: { source: "graph_mail", kind: "mail_message", occurredAt: { gte: new Date(item.clockStartedAt.getTime() - 30 * 86_400_000) } },
      orderBy: { occurredAt: "asc" },
      take: 1000,
    });
    return recs
      .filter((r) => ((r.fields ?? {}) as { message?: { conversationId?: string } }).message?.conversationId === item.sourceId)
      .map((r) => {
        const f = (r.fields ?? {}) as { from?: string; subject?: string; message?: { bodyPreview?: string } };
        return {
          at: (r.occurredAt ?? r.createdAt).toISOString(),
          kind: "message" as const,
          title: `Email · ${f.subject ?? ""}`.trim(),
          text: f.message?.bodyPreview ?? "",
          author: f.from ?? null,
          link: null,
          raiseLink: raiseEmail(r.externalId),
        };
      });
  }
  return [];
}

async function ticketComments(item: WorkItem): Promise<{ entries: TimelineEntry[]; error: string | null }> {
  const out: TimelineEntry[] = [];
  if (!isAtlassianConfigured()) return { entries: out, error: null };
  try {
    if (item.ticketKey) {
      const comments = item.ticketSystem === "jsm"
        ? (await listRequestComments(item.ticketKey)).map((c) => ({ at: c.created?.iso8601 ?? "", text: c.body, author: c.author?.displayName ?? null, internal: !c.public }))
        : (await listIssueComments(item.ticketKey)).map((c) => ({ at: c.created ?? "", text: adfToText(c.body).trim(), author: c.author?.displayName ?? null, internal: c.jsdPublic === false || c.jsdPublic === undefined }));
      for (const c of comments) out.push({ at: c.at, kind: "ticket_comment", title: `${item.ticketKey}${c.internal ? " · internal" : " · public"}`, text: c.text, author: c.author, link: item.ticketUrl, raiseLink: null, internal: c.internal });
    }
    if (item.clientTicketKey) {
      for (const c of await listRequestComments(item.clientTicketKey)) {
        out.push({ at: c.created?.iso8601 ?? "", kind: "ticket_comment", title: `${item.clientTicketKey} · ${c.public ? "client-visible" : "internal"}`, text: c.body, author: c.author?.displayName ?? null, link: item.clientTicketUrl, raiseLink: null, internal: !c.public });
      }
    }
    return { entries: out.filter((e) => e.at), error: null };
  } catch (error) {
    logger.warn("Timeline ticket comments unavailable", { error: error instanceof Error ? error.message : String(error) });
    return { entries: out.filter((e) => e.at), error: "Ticket comments could not be read from Jira right now." };
  }
}

export async function workItemDetail(id: string, now = new Date()) {
  const item = await prisma.workItem.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, displayName: true } },
      owner: { select: { id: true, name: true } },
      slaPolicy: true,
      ticketLinks: true,
      alerts: { select: { id: true, ruleCode: true, severity: true, status: true, message: true, firstFiredAt: true, fireCount: true } },
    },
  });
  if (!item) return null;

  const cal = item.slaPolicy ? await loadCalendar(item.slaPolicy.calendar, item.clockStartedAt, new Date(now.getTime() + 14 * 86_400_000)) : null;
  const sla: SlaStatus = slaStatus(item, item.slaPolicy?.isActive ? item.slaPolicy : null, cal, now);

  const [messages, comments, slaEvents, updates, audits] = await Promise.all([
    sourceMessages(item),
    ticketComments(item),
    prisma.slaEvent.findMany({ where: { workItemId: id }, orderBy: { at: "asc" } }),
    prisma.clientUpdate.findMany({ where: { workItemId: id }, orderBy: { createdAt: "asc" } }),
    prisma.auditLog.findMany({ where: { entityType: "work_item", entityId: id }, orderBy: { createdAt: "asc" }, take: 200 }),
  ]);

  const timeline: TimelineEntry[] = [
    ...messages,
    ...comments.entries,
    ...item.alerts.map((a) => ({ at: a.firstFiredAt.toISOString(), kind: "alert" as const, title: `${a.ruleCode} · ${a.severity} · ${a.status}`, text: a.message, author: null, link: "/alerts", raiseLink: null })),
    ...slaEvents.map((e) => ({ at: e.at.toISOString(), kind: "sla" as const, title: `SLA ${e.kind.replace("_", " ")}`, text: "", author: null, link: null, raiseLink: null })),
    ...updates.map((u) => ({ at: (u.postedAt ?? u.createdAt).toISOString(), kind: "client_update" as const, title: `Client ${u.kind} · ${u.status.replace("_", " ")}`, text: u.body, author: null, link: item.clientTicketUrl, raiseLink: null })),
    ...audits.map((a) => {
      const d = (a.details ?? {}) as { summary?: string };
      return { at: a.createdAt.toISOString(), kind: "change" as const, title: a.action.replace(/_/g, " "), text: d.summary ?? "", author: null, link: null, raiseLink: null };
    }),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const meta = (item.metadata ?? {}) as Record<string, unknown>;
  const replyTarget = item.kind === "client_request" ? await replyTargetFor(item) : null;
  const [cfg, assignees, templates] = await Promise.all([
    getSettings(["workItem.rootCauses", "workItem.riskScoreScale"] as const),
    prisma.employee.findMany({ where: { active: true, id: { not: "system" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    replyTarget ? firstResponseTemplates(item) : Promise.resolve([] as string[]),
  ]);
  return {
    item: {
      id: item.id,
      title: item.title,
      kind: item.kind,
      team: item.team,
      taskCode: item.taskCode,
      priority: item.priority,
      state: item.state,
      client: item.client ? { id: item.client.id, name: item.client.displayName } : null,
      owner: item.owner,
      ticketKey: item.ticketKey,
      ticketUrl: item.ticketUrl,
      ticketSystem: item.ticketSystem,
      clientTicketKey: item.clientTicketKey,
      clientTicketUrl: item.clientTicketUrl,
      clockStartedAt: item.clockStartedAt.toISOString(),
      ownedAt: item.ownedAt?.toISOString() ?? null,
      firstResponseAt: item.firstResponseAt?.toISOString() ?? null,
      resolvedAt: item.resolvedAt?.toISOString() ?? null,
      waitingReason: typeof meta.waitingReason === "string" ? meta.waitingReason : null,
      writebackError: typeof meta.writebackError === "string" ? meta.writebackError : null,
      relatedTickets: item.ticketLinks.filter((l) => l.role === "related").map((l) => ({ system: l.system, key: l.key, url: l.url })),
    },
    sla,
    timeline,
    timelineWarning: comments.error,
    raiseLink: `/client-incidents/new?kind=work_item&workItemId=${encodeURIComponent(item.id)}`,
    closeOptions: { rootCauses: cfg["workItem.rootCauses"], riskScale: cfg["workItem.riskScoreScale"], timeBuckets: [...TIME_LOG_BUCKETS] },
    assignees,
    firstResponse: replyTarget ? { channel: replyTarget.channel, templates, clientMapped: !!item.clientId, alreadyResponded: !!item.firstResponseAt } : null,
    canPostClientUpdate: (item.kind === "client_incident" || item.kind === "client_risk") && !!item.clientTicketKey,
  };
}
