/**
 * Alert catalogue (spec §11.2). Every rule has an owner team, a clock and an
 * escalation step. Rules are synced into AlertRule **disabled**; admins enable
 * them one by one. A `null` param is a CONFIRM placeholder that blocks enabling.
 *
 * Rules without `evaluate` are raised by events or jobs through raiseAlert
 * (status map, reports, reconciliation, IAI) or, for FAB, arrive with the
 * TASK-FAB register and mailbox parser (Phase 7, TODO(CONFIRM-FAB-TEMPLATES)).
 */

import type { AlertSeverity } from "@prisma/client";
import type { EscalationStep, RuleDefinition } from "@/modules/alerting/types";
import * as oes from "@/modules/alerting/evaluators/oes";
import * as risk from "@/modules/alerting/evaluators/risk";
import * as ops from "@/modules/alerting/evaluators/operations";
import { onSlaRaised, slaEvaluator, SLA_RULES } from "@/modules/alerting/evaluators/sla";

export const TEAMS = {
  txOps: "Transaction Operations",
  adminOps: "Admin Operations",
  dataOps: "Data Operations",
  staking: "Staking Ops",
  settlements: "Settlements",
} as const;

/** Default escalation ladder by severity (editable per rule in AlertRule.params.escalation). */
export function defaultEscalation(severity: AlertSeverity): EscalationStep[] {
  if (severity === "critical") return [{ afterMins: 15, notifyRole: "lead" }, { afterMins: 60, notifyRole: "admin" }];
  if (severity === "high") return [{ afterMins: 60, notifyRole: "lead" }];
  return [{ afterMins: 240, notifyRole: "lead" }];
}

type Def = Omit<RuleDefinition, "params"> & { params?: Record<string, unknown> };

const defs: Def[] = [
  // ── FAB (MVP0, email-driven; process page is draft — ship disabled) ──
  { code: "ALR-FAB-01", name: "FAB instruction received", ownerTeam: TEAMS.settlements, severity: "medium", clock: "immediate", ticketProject: undefined, autoResolve: true,
    params: { parser: null }, confirm: { parser: "CONFIRM-FAB-TEMPLATES" } },
  { code: "ALR-FAB-02", name: "FAB instruction not acknowledged", ownerTeam: TEAMS.settlements, severity: "high", clock: "CONFIRM-FAB-ACK-MINS", autoResolve: true,
    params: { ackMins: null }, confirm: { ackMins: "CONFIRM-FAB-ACK-MINS" } },
  { code: "ALR-FAB-03", name: "FAB instruction after cut-off", ownerTeam: TEAMS.settlements, severity: "medium", clock: "immediate", autoResolve: false,
    params: { cutoffLocal: "15:00", parser: null }, confirm: { parser: "CONFIRM-FAB-TEMPLATES" } },
  { code: "ALR-FAB-04", name: "FAB NACK sent", ownerTeam: TEAMS.settlements, severity: "medium", clock: "immediate", autoResolve: true,
    params: { parser: null }, confirm: { parser: "CONFIRM-FAB-TEMPLATES" } },
  { code: "ALR-FAB-05", name: "FAB settlement failed", ownerTeam: TEAMS.settlements, severity: "critical", clock: "immediate", autoResolve: false,
    params: { parser: null }, confirm: { parser: "CONFIRM-FAB-TEMPLATES" } },
  { code: "ALR-FAB-06", name: "FAB deposit not received by value date", ownerTeam: TEAMS.settlements, severity: "high", clock: "CONFIRM-FAB-VALUE-DATE-CUTOFF", autoResolve: true,
    params: { valueDateCutoffLocal: null }, confirm: { valueDateCutoffLocal: "CONFIRM-FAB-VALUE-DATE-CUTOFF" } },
  { code: "ALR-FAB-07", name: "FAB inbound KYT lock", ownerTeam: TEAMS.settlements, severity: "critical", clock: "immediate", autoResolve: true,
    params: { source: null }, confirm: { source: "CONFIRM-FAB-TEMPLATES" } },
  { code: "ALR-FAB-08", name: "FAB fee buffer low", ownerTeam: TEAMS.settlements, severity: "high", clock: "CONFIRM-FEE-THRESHOLDS", autoResolve: true,
    params: { thresholds: null, alertFormat: null }, confirm: { thresholds: "CONFIRM-FEE-THRESHOLDS", alertFormat: "CONFIRM-FEE-ALERT-FORMAT" } },

  // ── OES and collateral settlement ──
  { code: "ALR-OES-01", name: "Settlement failed", ownerTeam: TEAMS.txOps, severity: "critical", clock: "immediate", ticketProject: "TOPS", autoResolve: true,
    params: { lookbackHours: 24 }, evaluate: oes.evaluateSettlementFailed },
  { code: "ALR-OES-02", name: "Settlement stuck", ownerTeam: TEAMS.txOps, severity: "high", clock: "60 min", ticketProject: "TOPS", autoResolve: true,
    params: { stuckMins: 60 }, evaluate: oes.evaluateSettlementStuck },
  { code: "ALR-OES-03", name: "Settlement cycle did not run", ownerTeam: TEAMS.txOps, severity: "high", clock: "30 min (suggested)", ticketProject: "TOPS", autoResolve: true,
    params: { graceMins: 30, portfolioTypes: [] }, evaluate: oes.evaluateCycleDidNotRun },
  { code: "ALR-OES-04", name: "Settlement awaiting approval", ownerTeam: TEAMS.txOps, severity: "high", clock: "15 min (suggested)", ticketProject: "TOPS", autoResolve: true,
    params: { pendingMins: 15, settlementWalletIds: [] }, evaluate: oes.evaluateAwaitingApproval },
  { code: "ALR-OES-05", name: "Exchange not contacted", ownerTeam: TEAMS.txOps, severity: "critical", clock: "120 min", ticketProject: "TOPS", autoResolve: true, cadenceMins: 5,
    params: { contactMins: 120 }, evaluate: oes.evaluateExchangeNotContacted },
  { code: "ALR-OES-06", name: "End-of-day failure: client exposure", ownerTeam: TEAMS.txOps, severity: "critical", clock: "17:00 Europe/London", ticketProject: "TOPS", autoResolve: true,
    params: { eodLocal: "17:00" }, evaluate: oes.evaluateEndOfDayExposure, onRaised: oes.onEndOfDayExposure },
  { code: "ALR-OES-07", name: "Collateral operation failed", ownerTeam: TEAMS.txOps, severity: "high", clock: "immediate", ticketProject: "TOPS", autoResolve: false,
    params: { lookbackHours: 24 }, evaluate: oes.evaluateOperationFailed },

  // ── Risk-flagged transactions awaiting a human (read-only; approval stays in GX) ──
  { code: "ALR-RSK-01", name: "Medium risk pending", ownerTeam: TEAMS.txOps, severity: "high", clock: "CONFIRM-RSK-MED-MINS", autoResolve: true,
    params: { pendingMins: null }, confirm: { pendingMins: "CONFIRM-RSK-MED-MINS" }, evaluate: risk.evaluateMediumPending },
  { code: "ALR-RSK-02", name: "High risk pending", ownerTeam: TEAMS.txOps, severity: "critical", clock: "CONFIRM-RSK-HIGH-MINS", autoResolve: true,
    params: { pendingMins: null }, confirm: { pendingMins: "CONFIRM-RSK-HIGH-MINS" }, evaluate: risk.evaluateHighPending },
  { code: "ALR-RSK-03", name: "Requires Escalation", ownerTeam: TEAMS.txOps, severity: "critical", clock: "immediate", autoResolve: true,
    params: { pendingMins: 0 }, evaluate: risk.evaluateRequiresEscalation },
  { code: "ALR-RSK-04", name: "Emergency Stop active", ownerTeam: TEAMS.txOps, severity: "critical", clock: "immediate", autoResolve: true,
    params: { lookbackHours: 72, escalation: [{ afterMins: 0, notifyRole: "lead" }, { afterMins: 0, notifyRole: "admin" }] }, evaluate: risk.evaluateEmergencyStop },
  { code: "ALR-RSK-05", name: "Risk rule fallback", ownerTeam: TEAMS.adminOps, severity: "medium", clock: "daily digest 08:00", ticketProject: "AO", autoResolve: true, digest: true,
    params: {}, evaluate: risk.evaluateRuleFallback },
  { code: "ALR-RSK-06", name: "KYT hit after broadcast", ownerTeam: TEAMS.txOps, severity: "critical", clock: "immediate", autoResolve: false,
    params: { lookbackHours: 72 }, evaluate: risk.evaluateKytAfterBroadcast },
  { code: "ALR-RSK-07", name: "Low risk still pending", ownerTeam: TEAMS.txOps, severity: "high", clock: "10 min (suggested)", autoResolve: true,
    params: { pendingMins: 10 }, evaluate: risk.evaluateLowPending },
  { code: "ALR-RSK-08", name: "Pending, not risk-scored", ownerTeam: TEAMS.txOps, severity: "high", clock: "CONFIRM", autoResolve: true,
    params: { pendingMins: null, excludedWorkspaces: null }, confirm: { pendingMins: "CONFIRM-RSK-UNSCORED-MINS", excludedWorkspaces: "CONFIRM-RSK-UNSCORED-WORKSPACES" }, evaluate: risk.evaluateNotRiskScored },
  { code: "ALR-RSK-09", name: "Staking action pending", ownerTeam: TEAMS.staking, severity: "medium", clock: "CONFIRM", autoResolve: true,
    params: { pendingMins: null }, confirm: { pendingMins: "CONFIRM-RSK-STAKING-MINS" }, evaluate: risk.evaluateStakingPending },

  // ── Configuration, KPS, transactions and hygiene ──
  { code: "ALR-CFG-01", name: "Tap rule, whitelist or risk-parameter change", ownerTeam: TEAMS.txOps, severity: "high", clock: "immediate", ticketProject: "TOPS", autoResolve: false, cadenceMins: 5,
    params: { eventPatterns: null, lookbackHours: 24 }, confirm: { eventPatterns: "CONFIRM-AUDIT-EVENTS" }, evaluate: ops.evaluateConfigChange },
  { code: "ALR-CFG-02", name: "Unmapped external status", ownerTeam: TEAMS.txOps, severity: "medium", clock: "immediate", autoResolve: false, digest: true },
  { code: "ALR-KPS-01", name: "KPS realisation above RiskCo threshold", ownerTeam: TEAMS.txOps, severity: "critical", clock: "before execution", ticketProject: "KPR", autoResolve: true,
    params: { thresholdUsd: 1_000_000 }, evaluate: ops.evaluateKpsThreshold },
  { code: "ALR-TX-01", name: "Transaction failed", ownerTeam: TEAMS.txOps, severity: "high", clock: "immediate", ticketProject: "TOPS", autoResolve: false,
    params: { lookbackHours: 24 }, evaluate: ops.evaluateTxFailed },
  { code: "ALR-TX-02", name: "Transaction stuck", ownerTeam: TEAMS.txOps, severity: "high", clock: "per asset (AssetThreshold, seed 120 min)", ticketProject: "TOPS", autoResolve: true,
    params: { defaultStuckMins: 120 }, evaluate: ops.evaluateTxStuck },
  { code: "ALR-TR-01", name: "Travel rule case ageing", ownerTeam: TEAMS.txOps, severity: "medium", clock: "24h amber, 48h red", autoResolve: true, cadenceMins: 15,
    params: { amberHours: 24, redHours: 48 }, evaluate: ops.evaluateTravelRuleAgeing },
  ...Object.keys(SLA_RULES).map((code): Def => ({
    code,
    name: `SLA ${SLA_RULES[code].clock.replace("_", " ")} ${SLA_RULES[code].phase}`,
    ownerTeam: TEAMS.txOps,
    severity: SLA_RULES[code].phase === "warn" ? "medium" : "high",
    clock: "per SlaPolicy",
    autoResolve: true,
    evaluate: slaEvaluator(code),
    onRaised: onSlaRaised(code),
  })),
  { code: "ALR-CHK-01", name: "Daily check not done", ownerTeam: TEAMS.txOps, severity: "high", clock: "due time (dueByLocal)", ticketProject: "TOPS", autoResolve: true, cadenceMins: 5,
    params: {}, evaluate: ops.evaluateCheckNotDone },
  { code: "ALR-TKT-01", name: "Unticketed work found", ownerTeam: TEAMS.txOps, severity: "high", clock: "08:30", autoResolve: false },
  { code: "ALR-TKT-02", name: "Ticket divergence", ownerTeam: TEAMS.txOps, severity: "medium", clock: "hourly", autoResolve: false },
  { code: "ALR-IAI-01", name: "IAI draft overdue", ownerTeam: TEAMS.txOps, severity: "high", clock: "24h", ticketProject: "IAI", autoResolve: false,
    params: { escalation: [{ afterMins: 0, notifyRole: "admin" }] } },
  { code: "ALR-VND-01", name: "Vendor ticket no update", ownerTeam: TEAMS.txOps, severity: "medium", clock: "CONFIRM", ticketProject: "VSR", autoResolve: true, cadenceMins: 15,
    params: { businessHours: null }, confirm: { businessHours: "CONFIRM-VND-HOURS" }, evaluate: ops.evaluateVendorNoUpdate },
  { code: "ALR-HB-SOURCE", name: "Heartbeat lost", ownerTeam: TEAMS.txOps, severity: "high", clock: "2 x expectedEveryMins per source", autoResolve: true,
    params: { staleRecordMins: { "komainu_api.collateral": 24 * 60 } }, evaluate: ops.evaluateHeartbeats },
];

export const RULE_CATALOGUE: Record<string, RuleDefinition> = Object.fromEntries(
  defs.map((d) => [d.code, {
    ...d,
    params: { calendar: "business_uk", escalation: defaultEscalation(d.severity), ...(d.params ?? {}) },
  }]),
);

/** Params for a rule: catalogue defaults overlaid with the stored AlertRule.params. */
export function effectiveParams(code: string, stored: unknown): Record<string, unknown> {
  const base = RULE_CATALOGUE[code]?.params ?? {};
  const s = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  return { ...base, ...s };
}

/** CONFIRM placeholders still unset (spec §11.5: enabling such a rule returns 422 listing them). */
export function missingConfirmParams(code: string, stored: unknown): string[] {
  const def = RULE_CATALOGUE[code];
  if (!def) return [];
  const params = effectiveParams(code, stored);
  return Object.keys(def.params)
    .filter((k) => params[k] === null || params[k] === undefined)
    .map((k) => `${k} (${def.confirm?.[k] ?? "CONFIRM"})`);
}
