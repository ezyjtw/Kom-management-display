/**
 * Risk-flagged transactions awaiting a human (spec §11.2, ALR-RSK-01..09).
 * Read-only: approval stays in Platform (H1). Risk levels come from Platform signals
 * (spec §11.4); the rule-number -> tier mapping is config (RiskRuleTier,
 * seeded with every rule at High, TODO(CONFIRM-RISK-COMMITTEE)). Nothing is scored
 * locally (H5).
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { RiskLevel } from "@/modules/risk/signal-source";
import { fieldsOf, custodyRecords, minsSince, pick, stillListed, type Rec } from "@/modules/alerting/evaluators/source";
import { numParam, strListParam, type AlertCandidate, type EvaluatorContext } from "@/modules/alerting/types";

const ORDER: RiskLevel[] = ["low", "medium", "high", "requires_escalation"];
const KYT_RULES = [1, 5];
const EMERGENCY_STOP_RULE = 12;
const KYT_AFTER_BROADCAST_RULE = 5;
export const RULE_FALLBACK_REASON = "No Rule configurations found for the Risk Check";

export interface StoredSignal {
  id: string;
  requestId: string | null;
  transactionId: string | null;
  level: RiskLevel;
  rules: number[];
  reasons: string[];
  observedAt: Date;
  scope: string | null;
  cleared: boolean;
}

function toSignal(r: { externalId: string; occurredAt: Date | null; firstSeenAt: Date; fields: Prisma.JsonValue }): StoredSignal {
  const f = fieldsOf(r);
  const level = ORDER.includes(f.level as RiskLevel) ? (f.level as RiskLevel) : "high";
  return {
    id: r.externalId,
    requestId: typeof f.requestId === "string" ? f.requestId : null,
    transactionId: typeof f.transactionId === "string" ? f.transactionId : null,
    level,
    rules: Array.isArray(f.rules) ? f.rules.filter((n): n is number => typeof n === "number") : [],
    reasons: Array.isArray(f.reasons) ? f.reasons.filter((s): s is string => typeof s === "string") : [],
    observedAt: r.occurredAt ?? r.firstSeenAt,
    scope: typeof f.scope === "string" ? f.scope : null,
    cleared: f.cleared === true,
  };
}

export async function recentSignals(since: Date): Promise<StoredSignal[]> {
  const rows = await prisma.sourceRecord.findMany({
    where: { source: "platform", kind: "risk_signal", OR: [{ occurredAt: { gte: since } }, { occurredAt: null, firstSeenAt: { gte: since } }] },
    select: { externalId: true, occurredAt: true, firstSeenAt: true, fields: true },
    orderBy: { occurredAt: "asc" },
    take: 5000,
  });
  return rows.map(toSignal);
}

/** Tier for a signal: from its rule numbers via RiskRuleTier, otherwise the level Platform reported. */
export async function tierResolver(): Promise<(s: StoredSignal) => RiskLevel> {
  const tiers = new Map((await prisma.riskRuleTier.findMany()).map((t) => [t.rule, t.tier as RiskLevel]));
  return (s) => {
    if (s.level === "requires_escalation" || s.rules.length === 0) return s.level;
    return s.rules.map((r) => tiers.get(r) ?? "high").reduce((a, b) => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a), "low" as RiskLevel);
  };
}

interface PendingWithSignal {
  request: Rec;
  signal: StoredSignal | null;
  level: RiskLevel | null;
}

/** Pending requests joined to their latest risk signal. */
async function pendingRequests(now: Date): Promise<PendingWithSignal[]> {
  const requests = await custodyRecords("request", { status: "PENDING", ...stillListed });
  if (!requests.length) return [];
  const signals = await recentSignals(new Date(now.getTime() - 7 * 86_400_000));
  const tier = await tierResolver();
  const latest = new Map<string, StoredSignal>();
  for (const s of signals) if (s.requestId) latest.set(s.requestId, s); // ascending: last wins
  return requests.map((r) => {
    const s = latest.get(r.externalId) ?? null;
    return { request: r, signal: s, level: s ? tier(s) : null };
  });
}

/** TODO(CONFIRM-CUSTODY-OPENAPI): confirm which request/transaction field marks staking actions. */
const isStaking = (r: Rec) => ["type", "transactionType", "transaction_type"].some((f) => /STAK/i.test(pick(r, f) ?? ""));

function candidate(r: Rec, severity: AlertCandidate["severity"], title: string, detail: string): AlertCandidate {
  return { dedupeKey: r.externalId, severity, title, detail, workItemSeed: { kind: "screening_case", taskCode: "RSK" } };
}

function byLevel(level: RiskLevel, paramKey: string, severity: AlertCandidate["severity"], title: string) {
  return async (ctx: EvaluatorContext): Promise<AlertCandidate[]> => {
    const mins = numParam(ctx.params, paramKey, 0);
    return (await pendingRequests(ctx.now))
      .filter((p) => p.level === level && !isStaking(p.request) && minsSince(p.request.occurredAt, ctx.now) >= mins)
      .map((p) => {
        const kyt = p.signal!.rules.filter((n) => KYT_RULES.includes(n));
        return candidate(
          p.request,
          severity,
          title,
          `Request ${p.request.externalId} is PENDING with Platform risk ${level.replace("_", " ")} for ${Math.round(minsSince(p.request.occurredAt, ctx.now))} minutes. ` +
            `Rules: ${p.signal!.rules.join(", ") || "none"}. ${kyt.length ? `KYT trigger (rule ${kyt.join(", ")}): Compliance must clear it first. ` : ""}` +
            `Reasons: ${p.signal!.reasons.join("; ") || "none"}. Act in Platform.`,
        );
      });
  };
}

/** ALR-RSK-01: medium risk pending. */
export const evaluateMediumPending = byLevel("medium", "pendingMins", "high", "Medium risk request pending");
/** ALR-RSK-02: high risk pending (states whether it is a KYT trigger). */
export const evaluateHighPending = byLevel("high", "pendingMins", "critical", "High risk request pending");
/** ALR-RSK-03: requires escalation (immediate). */
export const evaluateRequiresEscalation = byLevel("requires_escalation", "pendingMins", "critical", "Risk: requires escalation");

/** ALR-RSK-07: low risk still pending (auto-approval failed). */
export const evaluateLowPending = byLevel("low", "pendingMins", "high", "Low risk request still pending");

/** ALR-RSK-04: Emergency Stop (rule 12) active for a client or globally. */
export async function evaluateEmergencyStop(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const signals = (await recentSignals(new Date(ctx.now.getTime() - numParam(ctx.params, "lookbackHours", 72) * 3_600_000)))
    .filter((s) => s.rules.includes(EMERGENCY_STOP_RULE));
  const latest = new Map<string, StoredSignal>();
  for (const s of signals) latest.set(s.scope ?? "global", s);
  return [...latest.entries()]
    .filter(([, s]) => !s.cleared)
    .map(([scope, s]) => ({
      dedupeKey: scope,
      severity: "critical" as const,
      title: `Emergency Stop active (${scope})`,
      detail: `Platform reported an Emergency Stop (rule ${EMERGENCY_STOP_RULE}) for ${scope} at ${s.observedAt.toISOString()}.`,
      workItemSeed: { kind: "screening_case", taskCode: "RSK" },
    }));
}

/** ALR-RSK-05: risk rule fallback ("No Rule configurations found"), daily digest. */
export async function evaluateRuleFallback(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const signals = (await recentSignals(new Date(ctx.now.getTime() - 24 * 3_600_000))).filter((s) => s.reasons.some((r) => r.includes(RULE_FALLBACK_REASON)));
  if (!signals.length) return [];
  const requests = new Map((await custodyRecords("request", { externalId: { in: signals.map((s) => s.requestId).filter((x): x is string => !!x) } })).map((r) => [r.externalId, r]));
  const keys = new Map<string, StoredSignal>();
  for (const s of signals) {
    const client = (s.requestId && pick(requests.get(s.requestId) ?? { fields: {} }, "organization")) || "unknown-client";
    keys.set(`${client}:risk_check`, s);
  }
  return [...keys.keys()].map((key) => ({
    dedupeKey: key,
    severity: "medium" as const,
    title: "Risk rule fallback: no rule configuration",
    detail: `Platform reported "${RULE_FALLBACK_REASON}" for ${key.split(":")[0]}. The client's risk configuration needs fixing.`,
    workItemSeed: { kind: "screening_case", taskCode: "RSK" },
  }));
}

/** ALR-RSK-06: KYT hit (rule 5) on a transaction already broadcast. */
export async function evaluateKytAfterBroadcast(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const signals = (await recentSignals(new Date(ctx.now.getTime() - numParam(ctx.params, "lookbackHours", 72) * 3_600_000)))
    .filter((s) => s.rules.includes(KYT_AFTER_BROADCAST_RULE) && s.transactionId);
  if (!signals.length) return [];
  const txs = await custodyRecords("transaction", { externalId: { in: signals.map((s) => s.transactionId!) } });
  const broadcast = new Set(txs.filter((t) => ["BROADCASTED", "CONFIRMED", "COMPLETED"].includes((t.status ?? "").toUpperCase())).map((t) => t.externalId));
  return [...new Set(signals.map((s) => s.transactionId!))]
    .filter((id) => broadcast.has(id))
    .map((id) => ({
      dedupeKey: id,
      severity: "critical" as const,
      title: "KYT hit after broadcast",
      detail: `Platform reported a KYT hit (rule ${KYT_AFTER_BROADCAST_RULE}) on transaction ${id}, which has already been broadcast. Compliance outcome required.`,
      workItemSeed: { kind: "screening_case", taskCode: "RSK" },
    }));
}

/** ALR-RSK-08: pending in wallets excluded from the risk engine (cold workspaces, internal, service providers). */
export async function evaluateNotRiskScored(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const workspaces = strListParam(ctx.params, "excludedWorkspaces");
  const mins = numParam(ctx.params, "pendingMins", 0);
  return (await pendingRequests(ctx.now))
    .filter((p) => !p.signal && workspaces.includes(pick(p.request, "workspace") ?? "") && minsSince(p.request.occurredAt, ctx.now) >= mins)
    .map((p) => candidate(p.request, "high", "Pending, not risk-scored", `Request ${p.request.externalId} in an unscored workspace has been PENDING ${Math.round(minsSince(p.request.occurredAt, ctx.now))} minutes.`));
}

/** ALR-RSK-09: staking actions pending (always High by design; kept apart from ALR-RSK-02). */
export async function evaluateStakingPending(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const mins = numParam(ctx.params, "pendingMins", 0);
  return (await pendingRequests(ctx.now))
    .filter((p) => isStaking(p.request) && minsSince(p.request.occurredAt, ctx.now) >= mins)
    .map((p) => candidate(p.request, "medium", "Staking action pending", `Staking request ${p.request.externalId} has been PENDING ${Math.round(minsSince(p.request.occurredAt, ctx.now))} minutes. Blotter required.`));
}
