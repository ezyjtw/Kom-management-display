/**
 * Read-only OES settlement matching view (spec §12 CHK-10): one row per
 * expected portfolio per settlement window, with the status timeline, open
 * ALR-OES alerts, the ticket and notes. Settlement approvals happen in the
 * platforms (H1); nothing here approves or changes a settlement.
 */

import { CronExpressionParser } from "cron-parser";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { komainuRecords, pick, stillListed, type Rec } from "@/modules/alerting/evaluators/source";
import { CONFLUENCE_PLACEHOLDER_PREFIX } from "@/modules/daily-checks/definitions";
import { getSetting } from "@/modules/settings/settings";
import { dec } from "@/lib/decimal";

export interface TimelineEntry {
  at: string;
  label: string;
}

export interface SettlementRow {
  windowKey: string;
  exchange: string;
  windowStart: string;
  portfolioId: string | null;
  settlementId: string | null;
  mappedStatus: string;
  rawStatus: string | null;
  timeline: TimelineEntry[];
  alerts: Array<{ id: string; ruleCode: string; status: string; message: string }>;
  ticketKey: string | null;
  ticketUrl: string | null;
  notes: Array<{ text: string; authorId: string; at: string }>;
  exposure: null | { workItemId: string; exposureUsd: string | null; band: string | null };
}

export interface SettlementView {
  date: string;
  rows: SettlementRow[];
  exposureBands: string[];
  clientTemplateUrl: string | null;
  cf39: string;
}

export const CF39_NOTICE = "Findings register CF-39: the client template uses the same \"minor technical issues\" wording for all exposure sizes. Choose the exposure band; do not rewrite the template.";

const exchangeOf = (r: Rec) => pick(r, "exchange", "venue")?.toLowerCase() ?? null;
const portfolioOf = (r: Rec) => pick(r, "portfolio_id", "portfolio");

async function windowsOn(date: string) {
  const dayStart = new Date(`${date}T00:00:00Z`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const out: Array<{ exchange: string; start: Date; key: string }> = [];
  for (const w of await prisma.oesWindow.findMany({ where: { isActive: true } })) {
    try {
      const it = CronExpressionParser.parse(w.cron, { currentDate: new Date(dayStart.getTime() - 1000), endDate: new Date(dayEnd.getTime() - 1000), tz: w.referenceTz });
      while (it.hasNext()) {
        const start = it.next().toDate();
        out.push({ exchange: w.exchange.toLowerCase(), start, key: `${date}:${w.exchange.toLowerCase()}:${start.toISOString().slice(11, 16)}Z` });
      }
    } catch (error) {
      logger.warn("Invalid OES window cron", { exchange: w.exchange, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export async function buildSettlementView(date: string, now = new Date()): Promise<SettlementView> {
  const windows = await windowsOn(date);
  const portfolios = await komainuRecords("portfolio", stillListed);
  const dayStart = new Date(`${date}T00:00:00Z`);
  const settlements = await komainuRecords("settlement", { occurredAt: { gte: new Date(dayStart.getTime() - 3_600_000), lt: new Date(dayStart.getTime() + 30 * 3_600_000) } });
  const alerts = await prisma.alert.findMany({
    where: { ruleCode: { startsWith: "ALR-OES-" }, OR: [{ status: { not: "resolved" } }, { firstFiredAt: { gte: dayStart } }] },
    include: { workItem: { select: { id: true, ticketKey: true, ticketUrl: true, exposureUsd: true, metadata: true } } },
  });
  const notes = await prisma.settlementNote.findMany({ where: { windowKey: { startsWith: date } }, orderBy: { createdAt: "asc" } });
  const rows: SettlementRow[] = [];
  const used = new Set<string>();

  const rowFor = (w: { exchange: string; start: Date; key: string }, portfolioId: string | null, s: Rec | null): SettlementRow => {
    if (s) used.add(s.externalId);
    const related = alerts.filter((a) => (s && a.dedupeKey === s.externalId) || (portfolioId && a.dedupeKey.startsWith(`${portfolioId}:${w.start.toISOString()}`)));
    const withTicket = related.find((a) => a.workItem?.ticketKey)?.workItem ?? null;
    const oes06 = related.find((a) => a.ruleCode === "ALR-OES-06" && a.workItem);
    const timeline: TimelineEntry[] = [{ at: w.start.toISOString(), label: `Window opens (${w.exchange})` }];
    if (s?.occurredAt) timeline.push({ at: s.occurredAt.toISOString(), label: "Settlement started" });
    if (s) timeline.push({ at: s.lastSeenAt.toISOString(), label: `Last seen: ${s.mappedStatus ?? "unknown"} (${s.status ?? "?"})` });
    for (const a of related) {
      timeline.push({ at: a.firstFiredAt.toISOString(), label: `${a.ruleCode} raised` });
      if (a.resolvedAt) timeline.push({ at: a.resolvedAt.toISOString(), label: `${a.ruleCode} ${a.autoResolvedAt ? "cleared" : "resolved"}` });
    }
    const rowNotes = notes.filter((n) => n.windowKey === w.key && n.portfolioId === (portfolioId ?? s?.externalId ?? ""));
    for (const n of rowNotes) timeline.push({ at: n.createdAt.toISOString(), label: "Note added" });
    timeline.sort((a, b) => a.at.localeCompare(b.at));
    const meta = (oes06?.workItem?.metadata ?? {}) as Record<string, unknown>;
    return {
      windowKey: w.key,
      exchange: w.exchange,
      windowStart: w.start.toISOString(),
      portfolioId,
      settlementId: s?.externalId ?? null,
      mappedStatus: s ? s.mappedStatus ?? "unknown" : w.start > now ? "not_started" : "no_record",
      rawStatus: s?.status ?? null,
      timeline,
      alerts: related.map((a) => ({ id: a.id, ruleCode: a.ruleCode, status: a.status, message: a.message })),
      ticketKey: withTicket?.ticketKey ?? null,
      ticketUrl: withTicket?.ticketUrl ?? null,
      notes: rowNotes.map((n) => ({ text: n.text, authorId: n.authorId, at: n.createdAt.toISOString() })),
      exposure: oes06?.workItem ? { workItemId: oes06.workItem.id, exposureUsd: oes06.workItem.exposureUsd != null ? dec(oes06.workItem.exposureUsd).toFixed(2) : null, band: typeof meta.exposureBand === "string" ? meta.exposureBand : null } : null,
    };
  };

  for (const w of windows) {
    const windowSettlements = settlements.filter((s) => exchangeOf(s) === w.exchange && s.occurredAt && s.occurredAt.getTime() >= w.start.getTime() - 3_600_000 && s.occurredAt.getTime() < w.start.getTime() + 6 * 3_600_000);
    for (const p of portfolios.filter((x) => exchangeOf(x) === w.exchange)) {
      const matches = windowSettlements.filter((s) => portfolioOf(s) === p.externalId && !used.has(s.externalId));
      rows.push(rowFor(w, p.externalId, matches.at(-1) ?? null));
    }
    // Settlements that match no expected portfolio are listed too.
    for (const s of windowSettlements.filter((x) => !used.has(x.externalId))) rows.push(rowFor(w, portfolioOf(s), s));
  }

  const chk10 = await prisma.dailyCheckDefinition.findUnique({ where: { code: "CHK-10" }, select: { confluenceUrl: true } });
  return {
    date,
    rows,
    exposureBands: await getSetting("oes.exposureBands"),
    clientTemplateUrl: chk10 && !chk10.confluenceUrl.startsWith(CONFLUENCE_PLACEHOLDER_PREFIX) ? chk10.confluenceUrl : null,
    cf39: CF39_NOTICE,
  };
}
