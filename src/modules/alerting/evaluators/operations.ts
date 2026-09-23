/**
 * Configuration, KPS, transactions and hygiene rules (spec §11.2):
 * ALR-CFG-01, ALR-KPS-01, ALR-TX-01/02, ALR-TR-01, ALR-CHK-01, ALR-VND-01,
 * ALR-HB-SOURCE.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { businessMinutesWith, loadCalendar, londonInstant, londonParts } from "@/modules/alerting/calendar";
import { periodsFor } from "@/modules/daily-checks/schedule";
import { fieldsOf, komainuRecords, minsSince, pick, stillListed } from "@/modules/alerting/evaluators/source";
import { numParam, strListParam, type AlertCandidate, type EvaluatorContext } from "@/modules/alerting/types";

/** ALR-CFG-01: ADMINISTRATION audit events matching the configured patterns (TODO(CONFIRM-AUDIT-EVENTS)). */
export async function evaluateConfigChange(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const patterns = strListParam(ctx.params, "eventPatterns").flatMap((p) => {
    try {
      return [new RegExp(p, "i")];
    } catch {
      logger.warn("Invalid ALR-CFG-01 pattern ignored", { pattern: p });
      return [];
    }
  });
  if (!patterns.length) return [];
  const since = new Date(ctx.now.getTime() - numParam(ctx.params, "lookbackHours", 24) * 3_600_000);
  const logs = await komainuRecords("audit_log", { status: "ADMINISTRATION", OR: [{ occurredAt: { gte: since } }, { occurredAt: null, lastSeenAt: { gte: since } }] });
  return logs
    .filter((l) => {
      const f = fieldsOf(l);
      const text = ["event", "action", "type", "event_type", "description"].map((k) => (typeof f[k] === "string" ? f[k] : "")).join(" ");
      return patterns.some((p) => p.test(text));
    })
    .map((l) => ({
      dedupeKey: l.externalId,
      severity: "high" as const,
      title: "Configuration change to review",
      detail: `Audit event ${pick(l, "event", "action", "type", "event_type") ?? l.externalId} at ${(l.occurredAt ?? l.lastSeenAt).toISOString()} matches a reviewed change pattern (tap rule, whitelist or risk parameter). Review under Control 3.3.`,
      workItemSeed: { kind: "internal_task" as const, taskCode: "CFG" },
    }));
}

/** ALR-KPS-01: KPS realisation at or above the RiskCo threshold with no RiskCo approval link. */
export async function evaluateKpsThreshold(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const threshold = numParam(ctx.params, "thresholdUsd", 1_000_000);
  const items = await prisma.workItem.findMany({
    where: { kind: "kps_case", state: { notIn: ["resolved", "closed"] }, exposureUsd: { gte: threshold } },
    include: { ticketLinks: { select: { role: true } } },
  });
  return items
    .filter((w) => {
      const meta = (w.metadata ?? {}) as Record<string, unknown>;
      return !w.ticketLinks.some((l) => l.role === "riskco_approval") && !meta.riskcoApprovalUrl;
    })
    .map((w) => ({
      dedupeKey: w.id,
      severity: "critical" as const,
      title: "KPS realisation above RiskCo threshold",
      detail: `${w.ticketKey ?? w.title}: USD ${w.exposureUsd} is at or above the RiskCo threshold (USD ${threshold}) and has no RiskCo approval link. Do not execute before approval.`,
      workItemId: w.id,
      exposureUsd: w.exposureUsd ?? undefined,
    }));
}

/** ALR-TX-01: transaction FAILED. */
export async function evaluateTxFailed(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const since = new Date(ctx.now.getTime() - numParam(ctx.params, "lookbackHours", 24) * 3_600_000);
  const rows = await komainuRecords("transaction", { status: "FAILED", occurredAt: { gte: since } });
  return rows.map((t) => ({
    dedupeKey: t.externalId,
    severity: "high" as const,
    title: `Transaction failed${pick(t, "asset") ? ` (${pick(t, "asset")})` : ""}`,
    detail: `Transaction ${t.externalId} failed at ${(t.occurredAt ?? t.lastSeenAt).toISOString()}.`,
    workItemSeed: { kind: "internal_task" as const, taskCode: "TX" },
  }));
}

/** ALR-TX-02: PENDING or BROADCASTED longer than the per-asset threshold (AssetThreshold; default row "*"). */
export async function evaluateTxStuck(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const thresholds = new Map((await prisma.assetThreshold.findMany()).map((t) => [t.asset.toUpperCase(), t.stuckMins]));
  const fallback = thresholds.get("*") ?? numParam(ctx.params, "defaultStuckMins", 120);
  const rows = await komainuRecords("transaction", { status: { in: ["PENDING", "BROADCASTED"] }, ...stillListed });
  return rows.flatMap((t) => {
    const asset = (pick(t, "asset") ?? "").toUpperCase();
    const limit = thresholds.get(asset) ?? fallback;
    const age = minsSince(t.occurredAt, ctx.now);
    if (!t.occurredAt || age <= limit) return [];
    return [{
      dedupeKey: t.externalId,
      severity: "high" as const,
      title: `Transaction stuck ${t.status}${asset ? ` (${asset})` : ""}`,
      detail: `Transaction ${t.externalId} has been ${t.status} for ${Math.round(age)} minutes (limit ${limit} for ${asset || "this asset"}).`,
      workItemSeed: { kind: "internal_task" as const, taskCode: "TX" },
    }];
  });
}

/** ALR-TR-01: travel rule case ageing (24h amber = medium, 48h red = high). */
export async function evaluateTravelRuleAgeing(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const amber = numParam(ctx.params, "amberHours", 24);
  const red = numParam(ctx.params, "redHours", 48);
  const cases = await prisma.travelRuleCase.findMany({
    where: { status: { not: "Resolved" }, createdAt: { lte: new Date(ctx.now.getTime() - amber * 3_600_000) } },
    select: { id: true, asset: true, direction: true, createdAt: true },
  });
  return cases.map((c) => {
    const hours = minsSince(c.createdAt, ctx.now) / 60;
    const isRed = hours >= red;
    return {
      dedupeKey: c.id,
      severity: isRed ? ("high" as const) : ("medium" as const),
      title: `Travel rule case ageing (${isRed ? "red" : "amber"})`,
      detail: `Travel rule case ${c.id} (${c.direction} ${c.asset}) has been open ${Math.floor(hours)} hours.`,
      workItemSeed: { kind: "travel_rule_case" as const, taskCode: "TR" },
    };
  });
}

/** ALR-CHK-01: a daily or weekly check past its due time (London) with no completed item for the period. */
export async function evaluateCheckNotDone(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const today = londonParts(ctx.now);
  const defs = await prisma.dailyCheckDefinition.findMany({ where: { isActive: true, frequency: { in: ["daily", "weekly"] } } });
  const out: AlertCandidate[] = [];
  for (const d of defs) {
    if (d.requiredFlag && !(await isFeatureEnabled(d.requiredFlag))) continue;
    const [h, m] = d.dueByLocal.split(":").map(Number);
    if (!Number.isFinite(h) || ctx.now < londonInstant(today.date, h * 60 + (m || 0))) continue;
    for (const period of await periodsFor(d, ctx.now)) {
      const done = await prisma.dailyCheckItem.count({ where: { definitionCode: d.code, periodKey: period.key, status: { not: "pending" } } });
      if (done) continue;
      out.push({
        dedupeKey: `${d.code}:${period.key}`,
        severity: "high",
        title: `Daily check not done: ${d.code}`,
        detail: `${d.code} ${d.name} (${d.team}) was due by ${d.dueByLocal} and has not been completed.`,
        workItemSeed: { kind: "report_task", team: d.team, taskCode: d.code },
      });
    }
  }
  return out;
}

/** ALR-VND-01: vendor ticket with no vendor update for N business hours (TODO(CONFIRM-VND-HOURS)). */
export async function evaluateVendorNoUpdate(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const hours = numParam(ctx.params, "businessHours", 0);
  if (hours <= 0) return [];
  const items = await prisma.workItem.findMany({ where: { kind: "vendor_ticket", state: { notIn: ["resolved", "closed"] } } });
  if (!items.length) return [];
  const oldest = new Date(Math.min(...items.map((w) => w.clockStartedAt.getTime())));
  const cal = await loadCalendar(String(ctx.params.calendar ?? "business_uk"), oldest, ctx.now);
  return items.flatMap((w) => {
    const meta = (w.metadata ?? {}) as Record<string, unknown>;
    const last = typeof meta.lastVendorUpdateAt === "string" ? new Date(meta.lastVendorUpdateAt) : w.clockStartedAt;
    const elapsed = businessMinutesWith(cal, last, ctx.now) / 60;
    if (elapsed < hours) return [];
    return [{
      dedupeKey: w.id,
      severity: "medium" as const,
      title: "Vendor ticket: no update",
      detail: `${w.ticketKey ?? w.title} has had no vendor update for ${Math.floor(elapsed)} business hours (limit ${hours}).`,
      workItemId: w.id,
    }];
  });
}

/**
 * ALR-HB-SOURCE: silence is an alert. A source is lost when its last success
 * is older than 2 x expectedEveryMins, or its newest record is older than a
 * source-specific limit (params.staleRecordMins[source]). The worker's own
 * heartbeat is ALR-HB-WORKER, checked from the web app.
 */
export async function evaluateHeartbeats(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const staleLimits = (ctx.params.staleRecordMins && typeof ctx.params.staleRecordMins === "object" ? ctx.params.staleRecordMins : {}) as Record<string, number>;
  const beats = await prisma.sourceHeartbeat.findMany();
  return beats.flatMap((b) => {
    const successAge = b.lastSuccessAt ? minsSince(b.lastSuccessAt, ctx.now) : Infinity;
    const recordLimit = staleLimits[b.source];
    const recordAge = b.lastRecordAt ? minsSince(b.lastRecordAt, ctx.now) : Infinity;
    const lost = successAge > 2 * b.expectedEveryMins;
    const stale = typeof recordLimit === "number" && recordAge > recordLimit;
    if (!lost && !stale) return [];
    return [{
      dedupeKey: b.source,
      severity: "high" as const,
      title: `Heartbeat lost: ${b.source}`,
      detail: lost
        ? `No successful poll of ${b.source} for ${Number.isFinite(successAge) ? Math.round(successAge) : "an unknown number of"} minutes (expected every ${b.expectedEveryMins}).`
        : `${b.source} polls succeed but the newest record is ${Math.round(recordAge)} minutes old (limit ${recordLimit}).`,
      workItemSeed: { kind: "internal_task" as const, taskCode: "HB" },
    }];
  });
}

/** ALR-CLI-01: client-attested inbound threshold not reviewed within N months (spec §12 CHK-05, CF-31; 12 months CONFIRM). */
export async function evaluateThresholdReview(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const months = numParam(ctx.params, "reviewMonths", 12);
  const cutoff = new Date(ctx.now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  const clients = await prisma.client.findMany({
    where: { isActive: true, inboundThresholdUsd: { not: null }, OR: [{ thresholdReviewedAt: null }, { thresholdReviewedAt: { lt: cutoff } }] },
    select: { id: true, displayName: true, thresholdReviewedAt: true },
  });
  return clients.map((c) => ({
    dedupeKey: c.id,
    severity: "medium" as const,
    title: `Inbound threshold review overdue: ${c.displayName}`,
    detail: c.thresholdReviewedAt
      ? `The client-attested inbound threshold was last reviewed ${c.thresholdReviewedAt.toISOString().slice(0, 10)} (more than ${months} months ago).`
      : "The client-attested inbound threshold has no recorded review date.",
    workItemSeed: { kind: "internal_task" as const, team: "Team 3", taskCode: "CHK-05", clientId: c.id },
  }));
}
