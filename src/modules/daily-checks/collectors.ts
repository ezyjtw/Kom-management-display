/**
 * Automated data pulls (spec §12 common template, b). A collector proposes
 * evidence and exception rows for a pending item; the operator still records
 * the pass (or the exceptions) explicitly, so nothing is passed silently
 * (spec §10.2). Proposals are stored on the item (autoResult).
 *
 * Where no source exists the check stays manual and has no collector.
 */

import type { DailyCheckItem } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { redactString } from "@/lib/log-redaction";
import { custodyRecords, minsSince, pick, pickNumber, stillListed } from "@/modules/alerting/evaluators/source";
import { londonParts } from "@/modules/alerting/calendar";
import type { ExceptionRow } from "@/modules/daily-checks/enforcement";
import { absDiff, dec } from "@/lib/decimal";

export interface Collected {
  available: boolean;
  reason?: string;
  recordCount?: number;
  dataAsOf?: string;
  source?: string;
  fields: Record<string, string | number | boolean>;
  exceptions: ExceptionRow[];
  suppressed: Array<{ summary: string; reason: string }>;
  notes: string[];
  collectedAt: string;
}

type Ctx = { item: DailyCheckItem; now: Date; spec: Record<string, unknown> };
type Collector = (ctx: Ctx) => Promise<Omit<Collected, "collectedAt">>;

const OPEN = ["open", "owned", "waiting_client", "waiting_vendor", "waiting_internal"] as const;

/** Mask a reference for display (H8): keeps the first and last 4 characters. */
export function redactRef(ref: string): string {
  const r = redactString(ref);
  return r === ref && ref.length > 12 ? `${ref.slice(0, 4)}…${ref.slice(-4)}` : r;
}

function unavailable(reason: string): Omit<Collected, "collectedAt"> {
  return { available: false, reason, fields: {}, exceptions: [], suppressed: [], notes: [] };
}

async function heartbeatAsOf(source: string): Promise<Date | null> {
  return (await prisma.sourceHeartbeat.findUnique({ where: { source } }))?.lastSuccessAt ?? null;
}

const num = (spec: Record<string, unknown>, key: string, fallback: number) => (typeof spec[key] === "number" ? (spec[key] as number) : fallback);

function bandOf(ageMins: number): string {
  if (ageMins < 60) return "<1h";
  if (ageMins < 240) return "1-4h";
  if (ageMins < 1440) return "4-24h";
  return ">24h";
}

const tally = (values: string[]) =>
  Object.entries(values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {}))
    .map(([k, n]) => `${k}: ${n}`)
    .join(", ") || "none";

async function openTicketItems(prefix: string, kind?: string) {
  return prisma.workItem.findMany({
    where: { state: { in: [...OPEN] }, ticketKey: { startsWith: `${prefix}-` }, ...(kind ? { kind: kind as never } : {}) },
    select: { id: true, ticketKey: true, title: true, ownerEmployeeId: true, clockStartedAt: true, metadata: true },
  });
}

export const COLLECTORS: Record<string, Collector> = {
  /** CHK-01: PENDING/BROADCASTED transactions older than the per-asset threshold; known-degraded assets are suppressed with their reason. */
  async "CHK-01"({ now }) {
    const asOf = await heartbeatAsOf("custody_api.transactions");
    if (!asOf) return unavailable("No successful the custody provider transactions poll yet");
    const txs = await custodyRecords("transaction", { status: { in: ["PENDING", "BROADCASTED"] }, ...stillListed });
    const thresholds = new Map((await prisma.assetThreshold.findMany()).map((t) => [t.asset.toUpperCase(), t.stuckMins]));
    const statuses = new Map((await prisma.assetStatus.findMany({ where: { status: { not: "normal" } } })).map((a) => [a.asset.toUpperCase(), a]));
    const fallback = thresholds.get("*") ?? 120;
    const exceptions: ExceptionRow[] = [];
    const suppressed: Collected["suppressed"] = [];
    for (const t of txs) {
      const asset = (pick(t, "asset") ?? "").toUpperCase();
      const age = minsSince(t.occurredAt, now);
      const limit = thresholds.get(asset) ?? fallback;
      if (!t.occurredAt || age <= limit) continue;
      const summary = `${asset || "unknown asset"} ${t.status} for ${Math.round(age)} min (limit ${limit})`;
      const known = statuses.get(asset);
      if (known?.status === "known_degraded" || known?.status === "sunset") suppressed.push({ summary, reason: `${known.status}: ${known.reason}` });
      else exceptions.push({ summary, reference: redactRef(t.externalId) });
    }
    return {
      available: true, recordCount: txs.length, dataAsOf: asOf.toISOString(), source: "custody API /v1/custody/transactions",
      fields: { stuckCount: exceptions.length + suppressed.length, suppressedCount: suppressed.length }, exceptions, suppressed,
      notes: ["ALR-TX-02 runs continuously; this check reviews the open items."],
    };
  },

  /** CHK-03: requests PENDING, CREATED or BLOCKED, by type and age band. Read-only (H1). */
  async "CHK-03"({ now, spec }) {
    const asOf = await heartbeatAsOf("custody_api.requests");
    if (!asOf) return unavailable("No successful the custody provider requests poll yet");
    const threshold = num(spec, "thresholdMins", 240); // TODO(CONFIRM-CHK03-THRESHOLD)
    const reqs = await custodyRecords("request", { status: { in: ["PENDING", "CREATED", "BLOCKED"] }, ...stillListed });
    const old = reqs.filter((r) => minsSince(r.occurredAt, now) > threshold);
    return {
      available: true, recordCount: reqs.length, dataAsOf: asOf.toISOString(), source: "custody API /v1/requests",
      fields: { byType: tally(reqs.map((r) => `${pick(r, "type") ?? "unknown"}/${r.status}`)), byAgeBand: tally(reqs.map((r) => bandOf(minsSince(r.occurredAt, now)))) },
      exceptions: old.map((r) => ({ summary: `${pick(r, "type") ?? "Request"} ${r.status} for ${Math.round(minsSince(r.occurredAt, now) / 60)}h`, reference: redactRef(r.externalId) })),
      suppressed: [],
      notes: [`Exceptions are requests older than ${threshold} minutes. Act in Platform; KOMmand Centre is read-only.`],
    };
  },

  /** CHK-10: one window's settlements against the expected portfolios. */
  async "CHK-10"({ item }) {
    const asOf = await heartbeatAsOf("custody_api.collateral");
    if (!asOf) return unavailable("No successful the custody provider collateral poll yet");
    const m = /^(\d{4}-\d{2}-\d{2}):([a-z0-9_-]+):(\d{2}:\d{2})Z$/.exec(item.periodKey ?? "");
    if (!m) return unavailable("Not a settlement-window item");
    const [, date, exchange, hhmm] = m;
    const start = new Date(`${date}T${hhmm}:00Z`);
    const portfolios = (await custodyRecords("portfolio", stillListed)).filter((p) => pick(p, "exchange", "venue")?.toLowerCase() === exchange);
    const settlements = (await custodyRecords("settlement", { occurredAt: { gte: new Date(start.getTime() - 60 * 60_000), lt: new Date(start.getTime() + 6 * 3_600_000) } }))
      .filter((s) => pick(s, "exchange", "venue")?.toLowerCase() === exchange);
    const count = (st: string[]) => settlements.filter((s) => st.includes(s.mappedStatus ?? "")).length;
    const seen = new Set(settlements.map((s) => pick(s, "portfolio_id", "portfolio")));
    const missing = portfolios.filter((p) => !seen.has(p.externalId));
    return {
      available: true, recordCount: settlements.length, dataAsOf: asOf.toISOString(), source: "custody API collateral settlements",
      fields: { portfoliosExpected: portfolios.length, settlementsSeen: settlements.length, completed: count(["completed"]), failed: count(["failed", "partial"]), inProgress: count(["in_progress", "pending"]) },
      exceptions: missing.map((p) => ({ summary: `No settlement for portfolio in the ${exchange} ${hhmm}Z window`, reference: redactRef(p.externalId) })),
      suppressed: [],
      notes: ["Failed and stuck settlements are ticketed by ALR-OES-*. The skipped-above-threshold check stays disabled until the threshold is set."],
    };
  },

  /** CHK-09K: open RLS items (restricted). */
  async "CHK-09K"() {
    const asOf = await heartbeatAsOf("atlassian.issues");
    if (!asOf) return unavailable("No successful Jira sync yet");
    const items = await openTicketItems("RLS");
    return { available: true, recordCount: items.length, dataAsOf: asOf.toISOString(), source: "Jira RLS", fields: {}, exceptions: [], suppressed: [], notes: ["ALR-RLS-01 flags realisations above the Risk Committee threshold."] };
  },

  /** CHK-11: open incidents plus PDEF and VND tickets. */
  async "CHK-11"() {
    const asOf = await heartbeatAsOf("atlassian.issues");
    const [incidents, platformDefects, vnd] = await Promise.all([
      prisma.incident.count({ where: { status: { not: "resolved" } } }),
      openTicketItems("PDEF"),
      openTicketItems("VND"),
    ]);
    return {
      available: true, recordCount: incidents + platformDefects.length + vnd.length, dataAsOf: (asOf ?? new Date()).toISOString(), source: "Incidents module, Jira PDEF and VND",
      fields: { incidents, platformDefectOpen: platformDefects.length, vndOpen: vnd.length }, exceptions: [], suppressed: [],
      notes: asOf ? [] : ["Jira has not synced yet: PDEF/VND counts may be incomplete."],
    };
  },

  /** CHK-12: open RCAs (VND) and overdue ones (no vendor update beyond the ALR-VND-01 limit). */
  async "CHK-12"({ now }) {
    const asOf = await heartbeatAsOf("atlassian.issues");
    if (!asOf) return unavailable("No successful Jira sync yet");
    const items = await openTicketItems("VND");
    const rule = await prisma.alertRule.findUnique({ where: { code: "ALR-VND-01" } });
    const hours = typeof (rule?.params as Record<string, unknown> | undefined)?.businessHours === "number" ? ((rule!.params as Record<string, number>).businessHours) : null;
    const overdue = hours === null ? [] : items.filter((w) => {
      const last = typeof (w.metadata as Record<string, unknown>)?.lastVendorUpdateAt === "string" ? new Date((w.metadata as Record<string, string>).lastVendorUpdateAt) : w.clockStartedAt;
      return minsSince(last, now) / 60 > hours;
    });
    return {
      available: true, recordCount: items.length, dataAsOf: asOf.toISOString(), source: "Jira VND and vendor emails",
      fields: { overdueCount: overdue.length }, exceptions: [], suppressed: [],
      notes: hours === null ? ["ALR-VND-01 hours not set (CONFIRM-VND-HOURS): overdue count is 0 until configured."] : [],
    };
  },

  /** CHK-13: open coin reviews (TOKENS) and those older than the review target. */
  async "CHK-13"({ now, spec }) {
    const asOf = await heartbeatAsOf("atlassian.issues");
    if (!asOf) return unavailable("No successful Jira sync yet");
    const days = num(spec, "overdueDays", 14); // TODO(CONFIRM-COIN-REVIEW-SLA)
    const items = await openTicketItems("TOKENS");
    const overdue = items.filter((w) => minsSince(w.clockStartedAt, now) > days * 1440);
    return { available: true, recordCount: items.length, dataAsOf: asOf.toISOString(), source: "Jira TOKENS", fields: { overdueCount: overdue.length }, exceptions: [], suppressed: [], notes: [] };
  },

  /** TASK-OTC: open OTC tickets, unassigned and overdue. */
  async "TASK-OTC"({ now, spec }) {
    const asOf = await heartbeatAsOf("atlassian.issues");
    if (!asOf) return unavailable("No successful Jira sync yet");
    const days = num(spec, "overdueDays", 5); // TODO(CONFIRM-OTC-OVERDUE)
    const items = await openTicketItems("OTC");
    return {
      available: true, recordCount: items.length, dataAsOf: asOf.toISOString(), source: "Jira OTC",
      fields: { unassignedCount: items.filter((w) => !w.ownerEmployeeId).length, overdueCount: items.filter((w) => minsSince(w.clockStartedAt, now) > days * 1440).length },
      exceptions: [], suppressed: [], notes: [],
    };
  },

  /** CHK-06: new screening candidates in the last 24 hours by classification. */
  async "CHK-06"({ now }) {
    const rows = await prisma.screeningEntry.findMany({ where: { createdAt: { gte: new Date(now.getTime() - 86_400_000) } }, select: { classification: true } });
    const c = (k: string) => rows.filter((r) => r.classification === k).length;
    return {
      available: true, recordCount: rows.length, dataAsOf: now.toISOString(), source: "Screening module",
      fields: { scamCount: c("scam"), dustCount: c("dust"), legitimateCount: c("legitimate"), unclassifiedCount: c("unclassified") },
      exceptions: [], suppressed: [], notes: c("unclassified") ? [`${c("unclassified")} candidate(s) still unclassified.`] : [],
    };
  },

  /**
   * CHK-04: screening in the last day from the Screening module (the Chainalysis
   * import replaces this when its template exists). Zero-value or no-hash
   * transactions cannot be screened and staking is excluded:
   * both are counted separately, never as screened.
   */
  async "CHK-04"({ now }) {
    const rows = await prisma.screeningEntry.findMany({
      where: { createdAt: { gte: new Date(now.getTime() - 86_400_000) } },
      select: { amount: true, txHash: true, screeningStatus: true, analyticsAlertId: true, isKnownException: true, exceptionReason: true },
    });
    // TODO(CONFIRM-STAKING-EXCLUSION): how staking exclusions are marked; known exceptions with a staking reason for now.
    const staking = rows.filter((r) => r.isKnownException && /stak/i.test(r.exceptionReason));
    const unscreenable = rows.filter((r) => !staking.includes(r) && (dec(r.amount).isZero() || !r.txHash));
    const screened = rows.filter((r) => !staking.includes(r) && !unscreenable.includes(r) && r.screeningStatus === "completed");
    return {
      available: true, recordCount: screened.length, dataAsOf: now.toISOString(), source: "Screening module",
      fields: { alertsCount: rows.filter((r) => r.analyticsAlertId).length, unscreenableCount: unscreenable.length, stakingExcludedCount: staking.length },
      exceptions: [], suppressed: [],
      notes: [`${rows.length - screened.length - unscreenable.length - staking.length} transaction(s) not yet screened.`],
    };
  },

  /** CHK-09: travel rule cases in scope today (the reconciliation import replaces this when its template exists). */
  async "CHK-09"({ now }) {
    const cases = await prisma.travelRuleCase.findMany({ where: { createdAt: { gte: new Date(now.getTime() - 86_400_000) } }, select: { matchStatus: true } });
    const matched = cases.filter((c) => c.matchStatus === "matched").length;
    return {
      available: true, recordCount: cases.length, dataAsOf: now.toISOString(), source: "Travel rule module (Notabene off, H11)",
      fields: { matchedCount: matched, unmatchedCount: cases.length - matched }, exceptions: [], suppressed: [],
      notes: ["Open cases keep the 24h and 48h ageing (ALR-TR-01)."],
    };
  },

  /**
   * CHK-16: wallet variances plus the position check staked ≤ total.
   * Partner confirmations are entered by the operator.
   */
  async "CHK-16"() {
    const asOf = await heartbeatAsOf("custody_api.eod_balances");
    if (!asOf) return unavailable("No successful EOD balance poll yet");
    const wallets = await prisma.stakingWallet.findMany({ where: { status: "active", isTestWallet: false } });
    // varianceThreshold is an absolute quantity in the wallet's asset (as in the staking module), compared exactly.
    const variances = wallets.filter((w) => w.onChainBalance != null && w.platformBalance != null &&
      absDiff(w.onChainBalance, w.platformBalance).gt(w.varianceThreshold));
    const since = new Date(asOf.getTime() - 36 * 3_600_000);
    const balances = await custodyRecords("eod_balance", { lastSeenAt: { gte: since } });
    // TODO(CONFIRM-CUSTODY-OPENAPI): staked and total balance field names.
    const violations = balances.filter((b) => {
      const staked = pickNumber(b, "staked_balance", "staked");
      const total = pickNumber(b, "total_balance", "total");
      return staked !== null && total !== null && staked > total;
    });
    return {
      available: true, recordCount: wallets.length, dataAsOf: asOf.toISOString(), source: "custody API EOD balances and staking wallets",
      fields: { variancesCount: variances.length, positionViolations: violations.length },
      exceptions: [
        ...variances.map((w) => ({ summary: `${w.asset} staking variance above ${dec(w.varianceThreshold).toFixed()} ${w.asset}`, reference: redactRef(w.walletAddress) })),
        ...violations.map((b) => ({ summary: `${pick(b, "asset") ?? "Asset"}: staked balance exceeds total (position check)`, reference: redactRef(b.externalId) })),
      ],
      suppressed: [],
      notes: ["Enter partner confirmations received and expected."],
    };
  },

  /** CHK-21: rewards seen versus wallets expecting one; overdue from the reward heartbeat model. */
  async "CHK-21"({ now }) {
    const asOf = await heartbeatAsOf("custody_api.staking");
    const wallets = await prisma.stakingWallet.findMany({ where: { status: "active", isTestWallet: false } });
    const expected = wallets.filter((w) => w.expectedNextRewardAt && w.expectedNextRewardAt <= now);
    const overdue = expected.filter((w) => !w.lastRewardAt || w.lastRewardAt < w.expectedNextRewardAt!);
    const rewards = await custodyRecords("staking_reward", { lastSeenAt: { gte: new Date(now.getTime() - 36 * 3_600_000) } });
    return {
      available: true, recordCount: expected.length, dataAsOf: (asOf ?? now).toISOString(), source: "custody API daily rewards and StakingWallet",
      fields: { rewardsSeen: rewards.length, overdueCount: overdue.length },
      exceptions: overdue.map((w) => ({ summary: `${w.asset} reward overdue (expected ${w.expectedNextRewardAt!.toISOString().slice(0, 10)})`, reference: redactRef(w.walletAddress) })),
      suppressed: [], notes: asOf ? [] : ["the custody provider rewards not polled yet: only the reward heartbeat model is used."],
    };
  },

  /** CHK-22: stakes first seen in the last day. */
  async "CHK-22"({ now }) {
    const asOf = await heartbeatAsOf("custody_api.stakes");
    if (!asOf) return unavailable("No successful stakes poll yet");
    const fresh = await prisma.sourceRecord.findMany({ where: { source: "custody_api", kind: "stake", firstSeenAt: { gte: new Date(now.getTime() - 86_400_000) } }, select: { externalId: true } });
    return {
      available: true, recordCount: fresh.length, dataAsOf: asOf.toISOString(), source: "custody API ETH and SOL stakes",
      fields: {}, exceptions: [], suppressed: [],
      notes: ["Check each new stake has its expected staking configuration (TODO(CONFIRM-STAKE-CONFIG))."],
    };
  },
};

/** Run the collector for one item and store the proposal. */
export async function collectForItem(itemId: string, now = new Date()): Promise<Collected | null> {
  const item = await prisma.dailyCheckItem.findUnique({ where: { id: itemId }, include: { definition: true } });
  if (!item?.definitionCode) return null;
  if (!Object.hasOwn(COLLECTORS, item.definitionCode)) return null;
  const collector = COLLECTORS[item.definitionCode];
  const spec = (item.definition?.evidenceSpec ?? {}) as Record<string, unknown>;
  let result: Collected;
  try {
    result = { ...(await collector({ item, now, spec })), collectedAt: now.toISOString() };
  } catch (error) {
    logger.warn("Evidence collector failed", { code: item.definitionCode, error: error instanceof Error ? error.message : String(error) });
    result = { ...unavailable("Collector failed; enter evidence manually"), collectedAt: now.toISOString() };
  }
  await prisma.dailyCheckItem.update({ where: { id: itemId }, data: { autoResult: JSON.stringify(result) } });
  return result;
}

/** Job `collect_check_evidence`: refresh proposals for today's pending items. */
export async function collectEvidenceForOpenItems(now = new Date()): Promise<{ collected: number }> {
  const today = londonParts(now).date;
  const items = await prisma.dailyCheckItem.findMany({
    where: { status: "pending", definitionCode: { in: Object.keys(COLLECTORS) }, createdAt: { gte: new Date(`${today}T00:00:00Z`) } },
    select: { id: true },
  });
  for (const i of items) await collectForItem(i.id, now);
  return { collected: items.length };
}

export function parseCollected(autoResult: string): Collected | null {
  if (!autoResult) return null;
  try {
    return JSON.parse(autoResult) as Collected;
  } catch {
    return null;
  }
}
