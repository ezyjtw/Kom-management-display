/**
 * Metrics sections (spec §13.3): responsiveness, clients, operations health
 * and hygiene, with data freshness. Team and client level only (H4): queries
 * select no person fields, and nothing is grouped by person.
 */

import { CronExpressionParser } from "cron-parser";
import { prisma } from "@/lib/prisma";
import { loadCalendar, londonInstant, type BusinessCalendar } from "@/modules/alerting/calendar";
import {
  alertLoad, backlogAge, breachCount, cadenceAttainment, cadenceOutcome, checkCompletion, clientEffortHours, elapsedMins, loggingCoverage,
  mtdClosure, pollingHealth, slaAttainment, timeTo, trendPct, windowOutcome, type Clock, type MeasuredItem, type WindowOutcome,
} from "@/modules/metrics/definitions";

export interface Period {
  from: Date;
  to: Date;
}

const OPEN = ["open", "owned", "waiting_client", "waiting_vendor", "waiting_internal"] as const;
const CLOCKS: Clock[] = ["ownership", "first_response", "resolution"];

export interface Freshness {
  asOf: string;
  sources: Array<{ source: string; lastSuccessAt: string | null; lastRecordAt: string | null; status: "ok" | "stale" | "never" }>;
}

export async function freshness(now = new Date(), prefixes: string[] = []): Promise<Freshness> {
  const beats = await prisma.sourceHeartbeat.findMany({ orderBy: { source: "asc" } });
  return {
    asOf: now.toISOString(),
    sources: beats
      .filter((b) => !prefixes.length || prefixes.some((p) => b.source.startsWith(p)))
      .map((b) => ({
        source: b.source,
        lastSuccessAt: b.lastSuccessAt?.toISOString() ?? null,
        lastRecordAt: b.lastRecordAt?.toISOString() ?? null,
        status: !b.lastSuccessAt ? "never" : now.getTime() - b.lastSuccessAt.getTime() > 2 * b.expectedEveryMins * 60_000 ? "stale" : "ok",
      })),
  };
}

function isNonActionable(metadata: unknown): boolean {
  const m = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  const c = m.closure && typeof m.closure === "object" ? (m.closure as Record<string, unknown>) : {};
  return c.nonActionable === true;
}

const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};

// ── Responsiveness (by team, channel and priority) ──

export async function responsiveness(period: Period, now = new Date()) {
  const items = await prisma.workItem.findMany({
    where: { clockStartedAt: { gte: period.from, lt: period.to } },
    select: {
      id: true, team: true, sourceSystem: true, priority: true, kind: true, state: true, metadata: true,
      clockStartedAt: true, ownedAt: true, firstResponseAt: true, resolvedAt: true,
      slaPolicy: { select: { code: true, ownershipMins: true, firstRespMins: true, resolveMins: true, resolveRule: true, calendar: true } },
    },
  });
  const calendars = new Map<string, BusinessCalendar>();
  for (const cal of new Set(items.map((i) => i.slaPolicy?.calendar ?? "24x7"))) calendars.set(cal, await loadCalendar(cal, period.from, now));
  const events = await prisma.slaEvent.findMany({ where: { at: { gte: period.from, lt: period.to } }, select: { workItemId: true, kind: true, at: true } });

  const summarise = (group: typeof items) => {
    const rows = group.filter((i) => i.slaPolicy).map((i) => ({
      item: { ...i, nonActionable: isNonActionable(i.metadata) } as MeasuredItem,
      policy: i.slaPolicy!,
      cal: calendars.get(i.slaPolicy!.calendar)!,
    }));
    const ids = new Set(group.map((i) => i.id));
    return {
      items: group.length,
      breaches: breachCount(events.filter((e) => ids.has(e.workItemId)), period.from, period.to),
      clocks: Object.fromEntries(CLOCKS.map((clock) => {
        const times = group.map((i) => timeTo({ ...i } as MeasuredItem, clock, calendars.get(i.slaPolicy?.calendar ?? "24x7"))).filter((t): t is number => t != null);
        return [clock, { medianMins: median(times), attainment: slaAttainment(rows, clock, now) }];
      })),
    };
  };
  const by = (key: (i: (typeof items)[number]) => string) => {
    const groups = new Map<string, typeof items>();
    for (const i of items) groups.set(key(i), [...(groups.get(key(i)) ?? []), i]);
    return Object.fromEntries([...groups.entries()].sort().map(([k, g]) => [k, summarise(g)]));
  };

  const open = await prisma.workItem.findMany({ where: { state: { in: [...OPEN] } }, select: { team: true, clockStartedAt: true } });
  const backlogByTeam: Record<string, ReturnType<typeof backlogAge>> = {};
  for (const team of new Set(open.map((o) => o.team))) backlogByTeam[team] = backlogAge(open.filter((o) => o.team === team), now);

  const policies = await prisma.slaPolicy.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, select: { code: true, ownershipMins: true, firstRespMins: true, resolveMins: true, resolveRule: true, calendar: true } });
  return {
    period: { from: period.from.toISOString(), to: period.to.toISOString() },
    overall: summarise(items),
    byTeam: by((i) => i.team),
    byChannel: by((i) => i.sourceSystem),
    byPriority: by((i) => i.priority),
    backlog: { all: backlogAge(open, now), byTeam: backlogByTeam },
    targets: policies.map((p) => ({
      code: p.code,
      calendar: p.calendar,
      ownership: p.ownershipMins ?? "target not set",
      firstResponse: p.firstRespMins ?? "target not set",
      resolution: p.resolveMins ?? (p.resolveRule === "next_business_day_eod" ? "next business day (end of day)" : "target not set"),
    })),
    freshness: await freshness(now, ["atlassian", "graph", "slack", "komainu_api.requests"]),
  };
}

// ── Clients (effort and volume ranked, month-on-month) ──

async function clientVolumes(period: Period) {
  const clients = await prisma.client.findMany({ where: { isActive: true }, select: { id: true, displayName: true, komainuOrgId: true, komainuAccountNos: true } });
  const [logs, requests, records, threads] = await Promise.all([
    prisma.timeLog.findMany({ where: { loggedAt: { gte: period.from, lt: period.to } }, select: { clientId: true, bucketMins: true } }),
    prisma.workItem.findMany({ where: { kind: "client_request", clockStartedAt: { gte: period.from, lt: period.to } }, select: { clientId: true } }),
    prisma.sourceRecord.findMany({ where: { source: "komainu_api", kind: { in: ["transaction", "request"] }, occurredAt: { gte: period.from, lt: period.to } }, select: { kind: true, fields: true } }),
    prisma.commsThread.findMany({ where: { createdAt: { gte: period.from, lt: period.to }, slackChannel: { clientId: { not: null } } }, select: { slackChannel: { select: { clientId: true } } } }),
  ]);
  const effort = clientEffortHours(logs);
  const orgToClient = new Map(clients.filter((c) => c.komainuOrgId).map((c) => [c.komainuOrgId!, c.id]));
  const accountToClient = new Map<string, string>();
  for (const c of clients) for (const a of Array.isArray(c.komainuAccountNos) ? (c.komainuAccountNos as string[]) : []) accountToClient.set(a, c.id);

  const volume = new Map<string, { requestsCreated: number; komainuTransactions: number; komainuRequests: number; slackThreads: number }>();
  const v = (id: string) => volume.get(id) ?? volume.set(id, { requestsCreated: 0, komainuTransactions: 0, komainuRequests: 0, slackThreads: 0 }).get(id)!;
  for (const r of requests) if (r.clientId) v(r.clientId).requestsCreated++;
  for (const r of records) {
    const f = (r.fields ?? {}) as Record<string, unknown>;
    const id = (typeof f.organization === "string" && orgToClient.get(f.organization)) || (typeof f.account === "string" && accountToClient.get(f.account));
    if (!id) continue;
    if (r.kind === "transaction") v(id).komainuTransactions++;
    else v(id).komainuRequests++;
  }
  for (const t of threads) if (t.slackChannel?.clientId) v(t.slackChannel.clientId).slackThreads++;
  return { clients, effort, volume };
}

export async function clientsSection(period: Period, now = new Date()) {
  const length = period.to.getTime() - period.from.getTime();
  const previous: Period = { from: new Date(period.from.getTime() - length), to: period.from };
  const [cur, prev] = await Promise.all([clientVolumes(period), clientVolumes(previous)]);
  const total = (x: { requestsCreated: number; komainuTransactions: number; komainuRequests: number; slackThreads: number } | undefined) =>
    x ? x.requestsCreated + x.komainuTransactions + x.komainuRequests + x.slackThreads : 0;

  const rows = cur.clients.map((c) => {
    const effort = Math.round((cur.effort.get(c.id) ?? 0) * 100) / 100;
    const prevEffort = prev.effort.get(c.id) ?? 0;
    const vol = cur.volume.get(c.id) ?? { requestsCreated: 0, komainuTransactions: 0, komainuRequests: 0, slackThreads: 0 };
    return {
      clientId: c.id,
      client: c.displayName,
      loggedEffortHours: effort,
      loggedEffortTrendPct: trendPct(effort, prevEffort),
      volume: { ...vol, total: total(vol) },
      volumeTrendPct: trendPct(total(vol), total(prev.volume.get(c.id))),
    };
  });
  return {
    period: { from: period.from.toISOString(), to: period.to.toISOString() },
    previousPeriod: { from: previous.from.toISOString(), to: previous.to.toISOString() },
    labels: { effort: "logged effort", volume: "volume, not effort" },
    byEffort: [...rows].sort((a, b) => b.loggedEffortHours - a.loggedEffortHours),
    byVolume: [...rows].sort((a, b) => b.volume.total - a.volume.total),
    freshness: await freshness(now, ["komainu_api", "slack", "graph"]),
  };
}

// ── Operations health (checks, OES, alerts, MTD) ──

function dueInstant(frequency: string, dueByLocal: string, periodKey: string | null): Date | null {
  if (!periodKey || !/^\d{2}:\d{2}$/.test(dueByLocal)) return null;
  const [h, m] = dueByLocal.split(":").map(Number);
  if (frequency === "daily" && /^\d{4}-\d{2}-\d{2}$/.test(periodKey)) return londonInstant(periodKey, h * 60 + m);
  return null;
}

async function oesHealth(period: Period, now: Date) {
  const windows = await prisma.oesWindow.findMany({ where: { isActive: true } });
  const to = new Date(Math.min(period.to.getTime(), now.getTime()));
  const from = new Date(Math.max(period.from.getTime(), to.getTime() - 31 * 86_400_000));
  const settlements = await prisma.sourceRecord.findMany({
    where: { source: "komainu_api", kind: "settlement", occurredAt: { gte: new Date(from.getTime() - 3_600_000), lt: new Date(to.getTime() + 6 * 3_600_000) } },
    select: { mappedStatus: true, occurredAt: true, fields: true },
  });
  const byExchange: Record<string, Record<WindowOutcome, number>> = {};
  for (const w of windows) {
    const ex = w.exchange.toLowerCase();
    const counts = (byExchange[ex] ??= { on_time: 0, failed: 0, stuck: 0, not_run: 0, in_progress: 0 });
    try {
      const it = CronExpressionParser.parse(w.cron, { currentDate: new Date(from.getTime() - 1000), endDate: to, tz: w.referenceTz });
      while (it.hasNext()) {
        const start = it.next().toDate();
        const seen = settlements.filter((s) => {
          const f = (s.fields ?? {}) as Record<string, unknown>;
          const sx = String(f.exchange ?? f.venue ?? "").toLowerCase();
          return sx === ex && s.occurredAt && s.occurredAt.getTime() >= start.getTime() - 3_600_000 && s.occurredAt.getTime() < start.getTime() + 6 * 3_600_000;
        });
        counts[windowOutcome(seen.map((s) => ({ mappedStatus: s.mappedStatus, startedAt: s.occurredAt })), start, now)]++;
      }
    } catch {
      // invalid cron: skipped (reported by the alerting engine)
    }
  }
  return byExchange;
}

export async function operationsHealth(period: Period, now = new Date()) {
  const [defs, items, alerts, breaks] = await Promise.all([
    prisma.dailyCheckDefinition.findMany({ where: { isActive: true }, select: { code: true, name: true, team: true, frequency: true, dueByLocal: true } }),
    prisma.dailyCheckItem.findMany({ where: { definitionCode: { not: null }, createdAt: { gte: period.from, lt: period.to } }, select: { definitionCode: true, periodKey: true, status: true, completedAt: true } }),
    prisma.alert.findMany({ where: { firstFiredAt: { gte: period.from, lt: period.to } }, select: { ruleCode: true, severity: true, firstFiredAt: true, acknowledgedAt: true, resolvedAt: true, autoResolvedAt: true } }),
    prisma.workItem.findMany({ where: { kind: "mtd_break", clockStartedAt: { gte: period.from, lt: period.to } }, select: { clockStartedAt: true, resolvedAt: true } }),
  ]);
  const checks = defs
    .map((d) => ({
      code: d.code,
      name: d.name,
      team: d.team,
      ...checkCompletion(items.filter((i) => i.definitionCode === d.code).map((i) => ({ status: i.status, completedAt: i.completedAt, dueAt: dueInstant(d.frequency, d.dueByLocal, i.periodKey) }))),
    }))
    .filter((c) => c.items > 0);
  const cal = await loadCalendar("business_uk", period.from, now);
  return {
    period: { from: period.from.toISOString(), to: period.to.toISOString() },
    checks,
    oesWindows: await oesHealth(period, now),
    alerts: alertLoad(alerts),
    mtdBreakClosure: mtdClosure(breaks, cal, now),
    freshness: await freshness(now, ["komainu_api.collateral", "komainu_api.transactions", "atlassian"]),
  };
}

// ── Hygiene (logging coverage, unticketed work, skipped checks) ──

export async function hygiene(period: Period, now = new Date()) {
  const closed = await prisma.workItem.findMany({
    where: { kind: "client_request", state: "closed", resolvedAt: { gte: period.from, lt: period.to } },
    select: { id: true, metadata: true },
  });
  const actionable = closed.filter((c) => !isNonActionable(c.metadata));
  const logged = new Set((await prisma.timeLog.findMany({ where: { workItemId: { in: actionable.map((c) => c.id) } }, select: { workItemId: true } })).map((l) => l.workItemId));
  const reports = await prisma.sourceRecord.findMany({
    where: { source: "kommand", kind: "unticketed_report", occurredAt: { gte: period.from, lt: period.to } },
    orderBy: { externalId: "asc" },
    select: { externalId: true, fields: true },
  });
  const skipped = await prisma.dailyCheckItem.findMany({ where: { status: "skipped", createdAt: { gte: period.from, lt: period.to } }, select: { definitionCode: true } });
  const skippedByCheck: Record<string, number> = {};
  for (const s of skipped) skippedByCheck[s.definitionCode ?? "legacy"] = (skippedByCheck[s.definitionCode ?? "legacy"] ?? 0) + 1;
  return {
    period: { from: period.from.toISOString(), to: period.to.toISOString() },
    loggingCoverage: { ...loggingCoverage(actionable.map((c) => c.id), logged), closedNonActionable: closed.length - actionable.length },
    unticketedWork: {
      target: 0,
      daily: reports.map((r) => ({ date: r.externalId, total: Number(((r.fields ?? {}) as Record<string, unknown>).total ?? 0) })),
    },
    skippedChecks: { total: skipped.length, byCheck: skippedByCheck },
    freshness: await freshness(now, ["atlassian", "graph", "slack"]),
  };
}

// ── Client incident communication (per client and severity; withheld as a count only) ──

export async function clientIncidentComms(period: Period, now = new Date()) {
  const items = await prisma.workItem.findMany({
    where: { kind: { in: ["client_incident", "client_risk"] }, clockStartedAt: { gte: period.from, lt: period.to } },
    select: { id: true, clientId: true, priority: true, clockStartedAt: true, resolvedAt: true, clientTicketKey: true, metadata: true },
  });
  const sensitive = (m: unknown) => ((m ?? {}) as Record<string, unknown>).complianceSensitive === true;
  // Compliance-sensitive entries are counted only: no client, severity or timing is reported for them (tipping-off risk).
  const withheld = items.filter((i) => sensitive(i.metadata)).length;
  const visible = items.filter((i) => !sensitive(i.metadata));
  const ids = visible.map((i) => i.id);
  const [clients, updates, links, rule] = await Promise.all([
    prisma.client.findMany({ where: { id: { in: [...new Set(visible.map((i) => i.clientId).filter((c): c is string => !!c))] } }, select: { id: true, displayName: true } }),
    prisma.clientUpdate.findMany({ where: { workItemId: { in: ids }, status: "posted" }, select: { workItemId: true, kind: true, postedAt: true } }),
    prisma.ticketLink.findMany({ where: { workItemId: { in: ids }, role: "client" }, select: { workItemId: true, createdAt: true } }),
    prisma.alertRule.findUnique({ where: { code: "ALR-CLI-02" }, select: { params: true } }),
  ]);
  const names = new Map(clients.map((c) => [c.id, c.displayName]));
  // TODO(CONFIRM-CLIENT-UPDATE-CADENCE): cadence per severity comes from ALR-CLI-02 params.
  const params = (rule?.params ?? {}) as Record<string, unknown>;
  const cadence = (params.cadenceMins && typeof params.cadenceMins === "object" ? params.cadenceMins : {}) as Record<string, unknown>;

  const rows = visible.map((i) => {
    const meta = (i.metadata ?? {}) as Record<string, unknown>;
    const requestAt = typeof meta.clientTicketCreatedAt === "string" ? new Date(meta.clientTicketCreatedAt) : links.find((l) => l.workItemId === i.id)?.createdAt ?? null;
    const posted = updates.filter((u) => u.workItemId === i.id && u.postedAt).map((u) => ({ kind: u.kind, at: u.postedAt! }));
    const firstUpdate = posted.filter((u) => u.kind === "update").sort((a, b) => a.at.getTime() - b.at.getTime())[0]?.at ?? null;
    const resolution = posted.find((u) => u.kind === "resolution")?.at ?? i.resolvedAt;
    const limit = cadence[i.priority];
    return {
      group: `${names.get(i.clientId ?? "") ?? "Unmapped"} · ${i.priority}`,
      raiseToRequestMins: requestAt ? elapsedMins(i.clockStartedAt, requestAt) : null,
      raiseToFirstUpdateMins: firstUpdate ? elapsedMins(i.clockStartedAt, firstUpdate) : null,
      raiseToResolvedMins: resolution ? elapsedMins(i.clockStartedAt, resolution) : null,
      cadence: requestAt && i.clientTicketKey && typeof limit === "number" ? cadenceOutcome(requestAt, posted.map((u) => u.at), resolution, limit, now) : null,
      hasRequest: !!i.clientTicketKey,
    };
  });
  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
  const summarise = (g: typeof rows) => ({
    raised: g.length,
    clientRequests: g.filter((r) => r.hasRequest).length,
    medianMins: {
      raiseToClientRequest: median(g.map((r) => r.raiseToRequestMins).filter((v): v is number => v != null)),
      raiseToFirstPublicUpdate: median(g.map((r) => r.raiseToFirstUpdateMins).filter((v): v is number => v != null)),
      raiseToResolved: median(g.map((r) => r.raiseToResolvedMins).filter((v): v is number => v != null)),
    },
    cadence: cadenceAttainment(g.map((r) => r.cadence)),
  });
  return {
    period: { from: period.from.toISOString(), to: period.to.toISOString() },
    overall: summarise(rows),
    byClientAndSeverity: Object.fromEntries([...groups.entries()].sort().map(([k, g]) => [k, summarise(g)])),
    withheldForCompliance: withheld,
    cadenceTargets: Object.keys(cadence).length ? cadence : "target not set",
    freshness: await freshness(now, ["atlassian", "slack", "outlook"]),
  };
}

// ── Polling health (share of 5-minute cycles on time, per source) ──

const POLL_RETENTION_DAYS = 90;

export async function pollingHealthSection(period: Period, now = new Date()) {
  const to = new Date(Math.min(period.to.getTime(), now.getTime()));
  const cycles = await prisma.pollCycle.findMany({
    where: { startedAt: { gte: period.from, lt: to } },
    select: { source: true, startedAt: true, finishedAt: true, ok: true },
  });
  const sources = [...new Set(["slack", ...cycles.map((c) => c.source)])].sort();
  const bySource: Record<string, ReturnType<typeof pollingHealth> & { measuredFrom: string | null }> = {};
  for (const source of sources) {
    // Measure from the first cycle ever recorded for the source (polling may have started mid-period).
    const first = await prisma.pollCycle.findFirst({ where: { source }, orderBy: { startedAt: "asc" }, select: { startedAt: true } });
    if (!first || first.startedAt >= to) {
      bySource[source] = { slots: 0, onTime: 0, failed: 0, pct: null, measuredFrom: null };
      continue;
    }
    const from = new Date(Math.max(period.from.getTime(), first.startedAt.getTime()));
    bySource[source] = { ...pollingHealth(cycles.filter((c) => c.source === source), from, to), measuredFrom: from.toISOString() };
  }
  return {
    period: { from: period.from.toISOString(), to: period.to.toISOString() },
    bySource,
    partial: period.from.getTime() < now.getTime() - POLL_RETENTION_DAYS * 86_400_000,
    note: `Cycle records are kept for ${POLL_RETENTION_DAYS} days.`,
    freshness: await freshness(now, ["slack.channels", "outlook"]),
  };
}

export const SECTIONS = {
  responsiveness,
  clients: clientsSection,
  operations: operationsHealth,
  hygiene,
  client_incidents: clientIncidentComms,
  polling: pollingHealthSection,
} as const;
export type SectionName = keyof typeof SECTIONS;

/** Calendar month "YYYY-MM" in UTC. */
export function monthPeriod(month: string): Period {
  const [y, m] = month.split("-").map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}

/** Period from ?month=YYYY-MM or ?from=&to= (YYYY-MM-DD, UTC); default the last 30 days. A string is a validation error. */
export function parsePeriod(params: URLSearchParams, now = new Date()): Period | string {
  const month = params.get("month");
  if (month) return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? monthPeriod(month) : "month must be YYYY-MM";
  const from = params.get("from");
  const to = params.get("to");
  if (!from && !to) return { from: new Date(now.getTime() - 30 * 86_400_000), to: now };
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return "from and to must be YYYY-MM-DD";
  const period = { from: new Date(`${from}T00:00:00Z`), to: new Date(`${to}T00:00:00Z`) };
  if (period.to <= period.from) return "to must be after from";
  if (period.to.getTime() - period.from.getTime() > 366 * 86_400_000) return "the period may not exceed a year";
  return period;
}

