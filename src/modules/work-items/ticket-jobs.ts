/**
 * Catching what slips through (spec §10.3):
 * - `report_unticketed` (08:30 UK): work that should have a ticket but has none;
 * - `reconcile_tickets` (hourly): open WorkItems vs open Jira/JSM tickets.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isAtlassianConfigured, searchIssues } from "@/lib/integrations/atlassian/client";
import { raiseAlert } from "@/modules/alerting/raise";
import { postAlertToSlack } from "@/modules/integrations/slack/alerts-out";
import { getSettings } from "@/modules/settings/settings";

const OPEN_STATES = ["open", "owned", "waiting_client", "waiting_vendor", "waiting_internal"] as const;
const LOOKBACK_MS = 7 * 24 * 3_600_000;
/** Messages younger than this are still being processed by intake. */
const GRACE_MS = 15 * 60_000;
const LIST_CAP = 200;

export interface UnticketedReport {
  generatedAt: string;
  clientMessagesWithoutRequest: Array<{ threadId: string; source: string; subject: string; at: string }>;
  alertsWithoutTicket: Array<{ alertId: string; ruleCode: string; message: string; workItemId: string | null }>;
  checksWithoutExceptions: Array<{ itemId: string; name: string; definitionCode: string | null }>;
  writebackFailures: Array<{ workItemId: string; title: string; error: string }>;
  total: number;
}

function meta(v: Prisma.JsonValue): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Root client messages from external authors, where KOMmand intake is on,
 * with no client_request. Slack and email are checked via their CommsThreads;
 * every channel (including Teams) is also checked via intake failure records.
 */
async function unticketedClientMessages(now: Date): Promise<UnticketedReport["clientMessagesWithoutRequest"]> {
  const cfg = await getSettings(["intake.slack.route", "intake.email.enabled", "intake.teams.enabled"] as const);
  const sources: Array<"slack" | "email"> = [];
  if (cfg["intake.slack.route"] === "kommand") sources.push("slack");
  if (cfg["intake.email.enabled"]) sources.push("email");
  const from = new Date(now.getTime() - LOOKBACK_MS);
  const to = new Date(now.getTime() - GRACE_MS);
  const out: UnticketedReport["clientMessagesWithoutRequest"] = [];

  if (sources.length) {
    const threads = await prisma.commsThread.findMany({
      where: {
        source: { in: sources },
        createdAt: { gte: from, lte: to },
        OR: [{ source: { not: "slack" } }, { slackChannel: { purpose: "client", clientId: { not: null } } }],
      },
      select: {
        id: true,
        source: true,
        subject: true,
        createdAt: true,
        messages: { orderBy: { timestamp: "asc" }, take: 1, select: { authorType: true, timestamp: true } },
      },
      take: 2000,
    });
    const externalRoots = threads.filter((t) => t.messages[0]?.authorType === "external");
    if (externalRoots.length) {
      const requests = await prisma.workItem.findMany({
        where: { kind: "client_request", clockStartedAt: { gte: new Date(from.getTime() - 24 * 3_600_000) } },
        select: { metadata: true },
      });
      const covered = new Set(requests.map((r) => meta(r.metadata).threadId).filter((v): v is string => typeof v === "string"));
      for (const t of externalRoots) {
        if (!covered.has(t.id)) {
          out.push({ threadId: t.id, source: String(t.source), subject: t.subject.slice(0, 120), at: (t.messages[0]?.timestamp ?? t.createdAt).toISOString() });
        }
      }
    }
  }

  if (sources.length || cfg["intake.teams.enabled"]) {
    const failed = await prisma.sourceRecord.findMany({
      where: {
        OR: [
          { source: "intake", kind: "message", status: "unrecorded_request" },
          { source: "graph_mail", kind: "mail_message", status: "intake_failed" },
        ],
        lastSeenAt: { gte: from },
      },
      select: { source: true, externalId: true, occurredAt: true, firstSeenAt: true },
      take: LIST_CAP,
    });
    for (const f of failed) {
      out.push({ threadId: f.externalId, source: f.source === "intake" ? "intake (ticket created, not recorded)" : "email (intake failed)", subject: "", at: (f.occurredAt ?? f.firstSeenAt).toISOString() });
    }
  }
  return out.slice(0, LIST_CAP);
}

export async function buildUnticketedReport(now = new Date()): Promise<UnticketedReport> {
  const [clientMessagesWithoutRequest, alerts, checks, failures] = await Promise.all([
    unticketedClientMessages(now),
    prisma.alert.findMany({
      where: { status: { not: "resolved" }, OR: [{ workItemId: null }, { workItem: { ticketKey: null } }] },
      select: { id: true, ruleCode: true, message: true, workItemId: true },
      orderBy: { createdAt: "asc" },
      take: LIST_CAP,
    }),
    prisma.dailyCheckItem.findMany({
      where: { status: "issues_found", exceptionWorkItemIds: { equals: [] } },
      select: { id: true, name: true, definitionCode: true },
      take: LIST_CAP,
    }),
    prisma.workItem.findMany({
      where: { state: { in: [...OPEN_STATES] }, ticketKey: null, NOT: { metadata: { path: ["writebackError"], equals: Prisma.AnyNull } } },
      select: { id: true, title: true, metadata: true },
      take: LIST_CAP,
    }),
  ]);

  const report: UnticketedReport = {
    generatedAt: now.toISOString(),
    clientMessagesWithoutRequest,
    alertsWithoutTicket: alerts.map((a) => ({ alertId: a.id, ruleCode: a.ruleCode, message: a.message.slice(0, 200), workItemId: a.workItemId })),
    checksWithoutExceptions: checks.map((c) => ({ itemId: c.id, name: c.name, definitionCode: c.definitionCode })),
    writebackFailures: failures.map((w) => {
      const err = meta(meta(w.metadata).writebackError as Prisma.JsonValue);
      return { workItemId: w.id, title: w.title.slice(0, 120), error: String(err.message ?? "unknown") };
    }),
    total: 0,
  };
  report.total =
    report.clientMessagesWithoutRequest.length + report.alertsWithoutTicket.length + report.checksWithoutExceptions.length + report.writebackFailures.length;
  return report;
}

/** London calendar date, used as the report's id so a re-run replaces that day's report. */
export function londonDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function summariseReport(r: UnticketedReport): string {
  if (r.total === 0) return "Unticketed work report: nothing found.";
  return [
    `Unticketed work report: ${r.total} item(s).`,
    `• Client messages with no request: ${r.clientMessagesWithoutRequest.length}`,
    `• Active alerts with no ticket: ${r.alertsWithoutTicket.length}`,
    `• Daily checks with issues but no exceptions: ${r.checksWithoutExceptions.length}`,
    `• Ticket write-back failures: ${r.writebackFailures.length}`,
  ].join("\n");
}

/** Job `report_unticketed`. Stored as a SourceRecord for the Morning Board; posted to alerts_out. */
export async function runUnticketedReport(now = new Date()) {
  const report = await buildUnticketedReport(now);
  const externalId = londonDateKey(now);
  await prisma.sourceRecord.upsert({
    where: { source_kind_externalId: { source: "kommand", kind: "unticketed_report", externalId } },
    update: { fields: report as unknown as Prisma.InputJsonValue, occurredAt: now, lastSeenAt: now, status: report.total ? "found" : "clear" },
    create: { source: "kommand", kind: "unticketed_report", externalId, fields: report as unknown as Prisma.InputJsonValue, occurredAt: now, status: report.total ? "found" : "clear" },
  });

  let posted = false;
  try {
    posted = await postAlertToSlack({ ruleCode: "REPORT-UNTICKETED", severity: report.total ? "high" : "info", message: summariseReport(report) });
  } catch (error) {
    logger.warn("Could not post the unticketed report to Slack", { error: error instanceof Error ? error.message : String(error) });
  }
  if (report.total > 0) {
    await raiseAlert({ ruleCode: "ALR-TKT-01", dedupeKey: externalId, message: summariseReport(report).split("\n")[0] });
  }
  return { date: externalId, total: report.total, posted };
}

/** Job `reconcile_tickets`: flag open WorkItems whose ticket is not open, and open tickets with no WorkItem. */
export async function reconcileTickets() {
  if (!isAtlassianConfigured()) return { skipped: true, reason: "Atlassian not configured" };
  const projects = await prisma.jiraProjectConfig.findMany({ where: { enabled: true }, select: { key: true, syncInbound: true } });
  if (!projects.length) return { skipped: true, reason: "No Jira projects enabled" };

  const keys = projects.map((p) => p.key);
  const remoteOpen = await searchIssues(`project in (${keys.map((k) => `"${k}"`).join(",")}) AND statusCategory != Done`);
  const remoteKeys = new Set(remoteOpen.map((i) => i.key));

  const localOpen = await prisma.workItem.findMany({
    where: { state: { in: [...OPEN_STATES] }, ticketKey: { not: null } },
    select: { ticketKey: true },
  });
  const inScope = (key: string) => keys.includes(key.split("-")[0]);
  const localKeys = new Set(localOpen.map((w) => w.ticketKey!).filter(inScope));

  const closedRemotely = [...localKeys].filter((k) => !remoteKeys.has(k));
  const inbound = new Set(projects.filter((p) => p.syncInbound).map((p) => p.key));
  const remoteCandidates = [...remoteKeys].filter((k) => !localKeys.has(k) && inbound.has(k.split("-")[0]));
  // An open ticket may still be tracked locally under a non-open state: that is divergence too.
  const knownLocally = new Set(
    (await prisma.workItem.findMany({ where: { ticketKey: { in: remoteCandidates } }, select: { ticketKey: true } })).map((w) => w.ticketKey!),
  );
  const missingLocally = remoteCandidates.filter((k) => !knownLocally.has(k));
  const reopenedRemotely = remoteCandidates.filter((k) => knownLocally.has(k));

  const divergent = closedRemotely.length + missingLocally.length + reopenedRemotely.length;
  if (divergent > 0) {
    const sample = [...closedRemotely, ...reopenedRemotely, ...missingLocally].slice(0, 20).join(", ");
    await raiseAlert({
      ruleCode: "ALR-TKT-02",
      dedupeKey: "reconcile",
      message: `Ticket divergence: ${closedRemotely.length} open work item(s) whose ticket is not open, ${reopenedRemotely.length} open ticket(s) whose work item is closed, ${missingLocally.length} open ticket(s) with no work item. ${sample}`,
    });
  }
  return { closedRemotely: closedRemotely.length, reopenedRemotely: reopenedRemotely.length, missingLocally: missingLocally.length };
}
