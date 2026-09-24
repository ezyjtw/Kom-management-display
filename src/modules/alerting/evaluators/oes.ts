/**
 * OES and collateral settlement rules (spec §11.2, ALR-OES-01..07).
 * Source: custody API settlements, collateral operations, portfolios and
 * requests, as stored by the collateral and request pollers.
 */

import { CronExpressionParser } from "cron-parser";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getIssue, isAtlassianConfigured } from "@/lib/integrations/atlassian/client";
import { commentInternal } from "@/modules/work-items/ticket-writeback";
import { londonInstant, londonParts } from "@/modules/alerting/calendar";
import { custodyRecords, minsSince, pick, stillListed } from "@/modules/alerting/evaluators/source";
import { numParam, strListParam, type AlertCandidate, type EvaluatorContext } from "@/modules/alerting/types";

export interface WindowInstance {
  exchange: string;
  start: Date;
  end: Date;
}

/** The most recent start of each active window at or before `now`. */
export async function latestWindows(now: Date): Promise<WindowInstance[]> {
  const windows = await prisma.oesWindow.findMany({ where: { isActive: true } });
  const out: WindowInstance[] = [];
  for (const w of windows) {
    try {
      const start = CronExpressionParser.parse(w.cron, { currentDate: new Date(now.getTime() + 1000), tz: w.referenceTz }).prev().toDate();
      out.push({ exchange: w.exchange.toLowerCase(), start, end: new Date(start.getTime() + w.durationMins * 60_000) });
    } catch (error) {
      logger.warn("Invalid OES window cron", { exchange: w.exchange, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return out;
}

const settlementExchange = (r: Parameters<typeof pick>[0]) => pick(r, "exchange", "venue", "exchange_name")?.toLowerCase() ?? null;
const settlementPortfolio = (r: Parameters<typeof pick>[0]) => pick(r, "portfolio_id", "portfolio", "portfolioId");

/** ALR-OES-01: settlement failed or partial in today's window. */
export async function evaluateSettlementFailed(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const since = new Date(ctx.now.getTime() - numParam(ctx.params, "lookbackHours", 24) * 3_600_000);
  const rows = await custodyRecords("settlement", { mappedStatus: { in: ["failed", "partial"] }, occurredAt: { gte: since } });
  return rows.map((r) => ({
    dedupeKey: r.externalId,
    severity: "critical",
    title: `Settlement ${r.mappedStatus}${settlementExchange(r) ? ` (${settlementExchange(r)})` : ""}`,
    detail: `Settlement ${r.externalId} is ${r.mappedStatus} (raw status ${r.status ?? "unknown"}). Contact the exchange and tag the ticket "exchange-contacted".`,
    workItemSeed: { kind: "oes_settlement", taskCode: "OES", priority: "P1" },
    priority: "P1",
  }));
}

/** ALR-OES-02: settlement still in progress N minutes after it started. */
export async function evaluateSettlementStuck(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const mins = numParam(ctx.params, "stuckMins", 60);
  const rows = await custodyRecords("settlement", { mappedStatus: "in_progress" });
  return rows
    .filter((r) => r.occurredAt && minsSince(r.occurredAt, ctx.now) > mins)
    .map((r) => ({
      dedupeKey: r.externalId,
      severity: "high",
      title: "Settlement stuck in progress",
      detail: `Settlement ${r.externalId} has been in progress for ${Math.round(minsSince(r.occurredAt, ctx.now))} minutes (limit ${mins}).`,
      workItemSeed: { kind: "oes_settlement", taskCode: "OES" },
    }));
}

/** ALR-OES-03: an expected portfolio has no settlement record by window start + N minutes. */
export async function evaluateCycleDidNotRun(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const grace = numParam(ctx.params, "graceMins", 30);
  const types = strListParam(ctx.params, "portfolioTypes");
  const windows = (await latestWindows(ctx.now)).filter((w) => minsSince(w.start, ctx.now) >= grace && minsSince(w.start, ctx.now) < 24 * 60);
  if (!windows.length) return [];

  const portfolios = (await custodyRecords("portfolio", stillListed)).filter((p) => {
    const status = (p.status ?? "").toLowerCase();
    const type = pick(p, "type", "portfolio_type");
    return (status === "" || status === "active") && (!types.length || (type !== null && types.includes(type)));
  });
  const earliest = new Date(Math.min(...windows.map((w) => w.start.getTime())) - 60 * 60_000);
  const settlements = await custodyRecords("settlement", { occurredAt: { gte: earliest } });

  const out: AlertCandidate[] = [];
  for (const w of windows) {
    for (const p of portfolios.filter((x) => settlementExchange(x) === w.exchange)) {
      const has = settlements.some((s) => settlementPortfolio(s) === p.externalId && s.occurredAt && s.occurredAt.getTime() >= w.start.getTime() - 60 * 60_000);
      if (!has) {
        out.push({
          dedupeKey: `${p.externalId}:${w.start.toISOString()}`,
          severity: "high",
          title: `Settlement cycle did not run (${w.exchange})`,
          detail: `No settlement record for portfolio ${p.externalId} by ${grace} minutes after the ${w.exchange} window at ${w.start.toISOString()}.`,
          workItemSeed: { kind: "oes_settlement", taskCode: "OES" },
        });
      }
    }
  }
  return out;
}

/** ALR-OES-04: collateral operation request (or settlement-wallet transaction) still PENDING. */
export async function evaluateAwaitingApproval(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const mins = numParam(ctx.params, "pendingMins", 15);
  const wallets = strListParam(ctx.params, "settlementWalletIds");
  const requests = (await custodyRecords("request", { status: "PENDING", ...stillListed }))
    .filter((r) => (pick(r, "type") ?? "").startsWith("COLLATERAL_OPERATION") && minsSince(r.occurredAt, ctx.now) > mins);
  const txs = wallets.length
    ? (await custodyRecords("transaction", { status: "PENDING", ...stillListed })).filter((t) => wallets.includes(pick(t, "walletId") ?? "") && minsSince(t.occurredAt, ctx.now) > mins)
    : [];
  return [...requests, ...txs].map((r) => ({
    dedupeKey: r.externalId,
    severity: "high",
    title: "Settlement awaiting approval",
    detail: `${r.externalId} has been PENDING for ${Math.round(minsSince(r.occurredAt, ctx.now))} minutes (limit ${mins}); the automated approver may have failed. Approval happens in Platform, not here.`,
    workItemSeed: { kind: "oes_settlement", taskCode: "OES" },
  }));
}

export const EXCHANGE_CONTACTED_TAG = "exchange-contacted";

/**
 * Whether the ticket carries the exchange-contacted tag, as a label or in a
 * comment. TODO(CONFIRM-EXCHANGE-CONTACTED-TAG): confirm how the team tags it.
 */
export async function ticketHasExchangeContacted(ticketKey: string): Promise<boolean> {
  if (!isAtlassianConfigured()) return false;
  const issue = await getIssue(ticketKey, ["labels", "comment"]);
  const fields = issue.fields as unknown as { labels?: string[]; comment?: unknown };
  if (fields.labels?.includes(EXCHANGE_CONTACTED_TAG)) return true;
  return JSON.stringify(fields.comment ?? "").includes(EXCHANGE_CONTACTED_TAG);
}

/** ALR-OES-05: ALR-OES-01/03 open and no exchange-contacted tag within N minutes. */
export async function evaluateExchangeNotContacted(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const mins = numParam(ctx.params, "contactMins", 120);
  const open = await prisma.alert.findMany({
    where: { ruleCode: { in: ["ALR-OES-01", "ALR-OES-03"] }, status: { not: "resolved" } },
    include: { workItem: { select: { id: true, ticketKey: true } } },
  });
  const out: AlertCandidate[] = [];
  for (const a of open) {
    if (minsSince(a.firstFiredAt, ctx.now) < mins) continue;
    let contacted = false;
    if (a.workItem?.ticketKey) {
      try {
        contacted = await ticketHasExchangeContacted(a.workItem.ticketKey);
      } catch (error) {
        logger.warn("Could not read ticket for exchange-contacted tag", { ticketKey: a.workItem.ticketKey, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (!contacted) {
      out.push({
        dedupeKey: a.id,
        severity: "critical",
        title: "Exchange not contacted",
        detail: `${a.ruleCode} (${a.message}) has been open ${Math.round(minsSince(a.firstFiredAt, ctx.now))} minutes with no "${EXCHANGE_CONTACTED_TAG}" tag on the ticket.`,
        workItemId: a.workItem?.id,
      });
    }
  }
  return out;
}

/** ALR-OES-06: ALR-OES-01 still open at the end-of-day time (London) of the day it fired. */
export async function evaluateEndOfDayExposure(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const [h, m] = String(ctx.params.eodLocal ?? "17:00").split(":").map(Number);
  const open = await prisma.alert.findMany({
    where: { ruleCode: "ALR-OES-01", status: { not: "resolved" } },
    include: { workItem: { select: { id: true, exposureUsd: true, state: true } } },
  });
  return open
    .filter((a) => ctx.now >= londonInstant(londonParts(a.firstFiredAt).date, h * 60 + m))
    .filter((a) => !a.workItem || !["resolved", "closed"].includes(a.workItem.state))
    .map((a) => ({
      dedupeKey: a.dedupeKey,
      severity: "critical" as const,
      title: "End-of-day settlement failure: client exposure",
      detail: `Settlement ${a.dedupeKey} is still failed at end of day. Confirm the client understands the exchange exposure${a.workItem?.exposureUsd != null ? ` (USD ${a.workItem.exposureUsd})` : ""}.`,
      workItemId: a.workItem?.id,
      exposureUsd: a.workItem?.exposureUsd ?? undefined,
    }));
}

/** On ALR-OES-06: add the "confirm client understands exposure" task to the ticket. */
export async function onEndOfDayExposure(_alertId: string, candidate: AlertCandidate): Promise<void> {
  if (!candidate.workItemId) return;
  try {
    await commentInternal(
      candidate.workItemId,
      `Task: confirm the client understands the exchange exposure${candidate.exposureUsd !== undefined ? ` (USD ${candidate.exposureUsd})` : " (record the exposure amount)"}. Use the client notification template and choose an exposure band.`,
    );
  } catch (error) {
    logger.warn("Could not add the end-of-day exposure task", { error: error instanceof Error ? error.message : String(error) });
  }
}

/** ALR-OES-07: collateral operation failed. */
export async function evaluateOperationFailed(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const since = new Date(ctx.now.getTime() - numParam(ctx.params, "lookbackHours", 24) * 3_600_000);
  const rows = await custodyRecords("collateral_operation", { mappedStatus: "failed", OR: [{ occurredAt: { gte: since } }, { occurredAt: null, lastSeenAt: { gte: since } }] });
  return rows.map((r) => ({
    dedupeKey: r.externalId,
    severity: "high",
    title: "Collateral operation failed",
    detail: `Collateral operation ${r.externalId} failed (raw status ${r.status ?? "unknown"}).`,
    workItemSeed: { kind: "oes_settlement", taskCode: "OES" },
  }));
}
