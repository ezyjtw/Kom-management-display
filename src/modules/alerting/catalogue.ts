/**
 * Alert catalogue (spec §11.2). Every rule has an owner team, a clock and an
 * escalation step. Rules are synced into AlertRule **disabled**; admins enable
 * them one by one. A `null` param is a CONFIRM placeholder that blocks enabling.
 *
 * Rules without `evaluate` are raised by events or jobs through raiseAlert
 * (status map, reports, reconciliation, INC). BANK rules read the TASK-BANK
 * register (spec §12) and evaluate nothing while module.bank is off.
 */

import type { AlertSeverity } from "@prisma/client";
import type { EscalationStep, RuleDefinition } from "@/modules/alerting/types";
import * as oes from "@/modules/alerting/evaluators/oes";
import * as risk from "@/modules/alerting/evaluators/risk";
import * as ops from "@/modules/alerting/evaluators/operations";
import * as bank from "@/modules/alerting/evaluators/bank";
import * as platform from "@/modules/alerting/evaluators/platform";
import * as sec from "@/modules/alerting/evaluators/security";
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
  // ── BANK (MVP0; process page is draft — ship disabled; evaluated only while module.bank is on) ──
  { code: "ALR-BANK-01", name: "BANK instruction received", ownerTeam: TEAMS.settlements, severity: "medium", clock: "immediate", autoResolve: true,
    params: {}, evaluate: bank.evaluateInstructionReceived },
  { code: "ALR-BANK-02", name: "BANK instruction not acknowledged", ownerTeam: TEAMS.settlements, severity: "high", clock: "CONFIRM-BANK-ACK-MINS", autoResolve: true,
    params: { ackMins: null }, confirm: { ackMins: "CONFIRM-BANK-ACK-MINS" }, evaluate: bank.evaluateNotAcknowledged },
  { code: "ALR-BANK-03", name: "BANK instruction after cut-off", ownerTeam: TEAMS.settlements, severity: "medium", clock: "immediate", autoResolve: false,
    params: { cutoffLocal: "15:00" }, evaluate: bank.evaluateAfterCutoff, onRaised: bank.onAfterCutoff },
  { code: "ALR-BANK-04", name: "BANK NACK sent", ownerTeam: TEAMS.settlements, severity: "medium", clock: "immediate", autoResolve: true,
    params: {}, evaluate: bank.evaluateNackSent },
  { code: "ALR-BANK-05", name: "BANK settlement failed", ownerTeam: TEAMS.settlements, severity: "critical", clock: "immediate", autoResolve: false,
    params: {}, evaluate: bank.evaluateSettlementFailed },
  { code: "ALR-BANK-06", name: "BANK deposit not received by value date", ownerTeam: TEAMS.settlements, severity: "high", clock: "CONFIRM-BANK-VALUE-DATE-CUTOFF", autoResolve: true,
    params: { valueDateCutoffLocal: null }, confirm: { valueDateCutoffLocal: "CONFIRM-BANK-VALUE-DATE-CUTOFF" }, evaluate: bank.evaluateDepositNotReceived },
  { code: "ALR-BANK-07", name: "BANK inbound KYT lock", ownerTeam: TEAMS.settlements, severity: "critical", clock: "immediate", autoResolve: true,
    params: {}, evaluate: bank.evaluateInboundKytLock },
  { code: "ALR-BANK-08", name: "BANK fee buffer low", ownerTeam: TEAMS.settlements, severity: "high", clock: "CONFIRM-FEE-THRESHOLDS", autoResolve: true,
    params: { thresholds: null }, confirm: { thresholds: "CONFIRM-FEE-THRESHOLDS" }, evaluate: bank.evaluateFeeBufferLow },

  // ── OES and collateral settlement ──
  { code: "ALR-OES-01", name: "Settlement failed", ownerTeam: TEAMS.txOps, severity: "critical", clock: "immediate", ticketProject: "OPS", autoResolve: true,
    params: { lookbackHours: 24 }, evaluate: oes.evaluateSettlementFailed },
  { code: "ALR-OES-02", name: "Settlement stuck", ownerTeam: TEAMS.txOps, severity: "high", clock: "60 min", ticketProject: "OPS", autoResolve: true,
    params: { stuckMins: 60 }, evaluate: oes.evaluateSettlementStuck },
  { code: "ALR-OES-03", name: "Settlement cycle did not run", ownerTeam: TEAMS.txOps, severity: "high", clock: "30 min (suggested)", ticketProject: "OPS", autoResolve: true,
    params: { graceMins: 30, portfolioTypes: [] }, evaluate: oes.evaluateCycleDidNotRun },
  { code: "ALR-OES-04", name: "Settlement awaiting approval", ownerTeam: TEAMS.txOps, severity: "high", clock: "15 min (suggested)", ticketProject: "OPS", autoResolve: true,
    params: { pendingMins: 15, settlementWalletIds: [] }, evaluate: oes.evaluateAwaitingApproval },
  { code: "ALR-OES-05", name: "Exchange not contacted", ownerTeam: TEAMS.txOps, severity: "critical", clock: "120 min", ticketProject: "OPS", autoResolve: true, cadenceMins: 5,
    params: { contactMins: 120 }, evaluate: oes.evaluateExchangeNotContacted },
  { code: "ALR-OES-06", name: "End-of-day failure: client exposure", ownerTeam: TEAMS.txOps, severity: "critical", clock: "17:00 Europe/London", ticketProject: "OPS", autoResolve: true,
    params: { eodLocal: "17:00" }, evaluate: oes.evaluateEndOfDayExposure, onRaised: oes.onEndOfDayExposure },
  { code: "ALR-OES-07", name: "Collateral operation failed", ownerTeam: TEAMS.txOps, severity: "high", clock: "immediate", ticketProject: "OPS", autoResolve: false,
    params: { lookbackHours: 24 }, evaluate: oes.evaluateOperationFailed },

  // ── Risk-flagged transactions awaiting a human (read-only; approval stays in Platform) ──
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

  // ── Configuration, RLS, transactions and hygiene ──
  { code: "ALR-CFG-01", name: "Tap rule, whitelist or risk-parameter change", ownerTeam: TEAMS.txOps, severity: "high", clock: "immediate", ticketProject: "OPS", autoResolve: false, cadenceMins: 5,
    params: { eventPatterns: null, lookbackHours: 24 }, confirm: { eventPatterns: "CONFIRM-AUDIT-EVENTS" }, evaluate: ops.evaluateConfigChange },
  { code: "ALR-CFG-02", name: "Unmapped external status", ownerTeam: TEAMS.txOps, severity: "medium", clock: "immediate", autoResolve: false, digest: true },
  { code: "ALR-RLS-01", name: "RLS realisation above Risk Committee threshold", ownerTeam: TEAMS.txOps, severity: "critical", clock: "before execution", ticketProject: "RLS", autoResolve: true,
    params: { thresholdUsd: 1_000_000 }, evaluate: ops.evaluateRealisationThreshold },
  { code: "ALR-TX-01", name: "Transaction failed", ownerTeam: TEAMS.txOps, severity: "high", clock: "immediate", ticketProject: "OPS", autoResolve: false,
    params: { lookbackHours: 24 }, evaluate: ops.evaluateTxFailed },
  { code: "ALR-TX-02", name: "Transaction stuck", ownerTeam: TEAMS.txOps, severity: "high", clock: "per asset (AssetThreshold, seed 120 min)", ticketProject: "OPS", autoResolve: true,
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
  { code: "ALR-CHK-01", name: "Daily check not done", ownerTeam: TEAMS.txOps, severity: "high", clock: "due time (dueByLocal)", ticketProject: "OPS", autoResolve: true, cadenceMins: 5,
    params: {}, evaluate: ops.evaluateCheckNotDone },
  // ── Client incidents and risks (spec §9.7) ──
  // Spec §16.6 Platform sprint UAT
  { code: "ALR-UAT-01", name: "New Platform sprint changes need UAT", ownerTeam: TEAMS.txOps, severity: "medium", clock: "immediate", autoResolve: false, params: {} },
  { code: "ALR-UAT-02", name: "UAT not complete before PROD", ownerTeam: TEAMS.txOps, severity: "high", clock: "2 business days before PROD", autoResolve: true, cadenceMins: 60,
    params: { businessDaysBeforeProd: 2 }, evaluate: platform.evaluateUatBeforeProd },
  { code: "ALR-UAT-03", name: "UAT failed", ownerTeam: TEAMS.txOps, severity: "high", clock: "immediate", autoResolve: false, params: {} },
  { code: "ALR-UAT-04", name: "Release notes changed after UAT sign-off", ownerTeam: TEAMS.txOps, severity: "high", clock: "immediate", autoResolve: false, params: {} },
  { code: "ALR-UAT-05", name: "Risk-engine or permission change in sprint", ownerTeam: TEAMS.txOps, severity: "high", clock: "immediate", autoResolve: false,
    // TODO(CONFIRM-COMPLIANCE-ROUTE): notify Compliance (risk engine) or IT (permissions) via the rule's route.
    params: {} },
  { code: "ALR-HB-RELNOTES", name: "Release notes not found", ownerTeam: TEAMS.txOps, severity: "medium", clock: "1 day", autoResolve: true, cadenceMins: 60,
    params: { graceHours: 24 }, evaluate: platform.evaluateReleaseNotesMissing },
  { code: "ALR-CLI-01", name: "Client incident or risk raised", ownerTeam: TEAMS.txOps, severity: "high", clock: "immediate (P0/P1 critical)", autoResolve: false,
    params: {} },
  { code: "ALR-CLI-02", name: "Client update overdue", ownerTeam: TEAMS.txOps, severity: "high", clock: "CONFIRM-CLIENT-UPDATE-CADENCE", autoResolve: true, cadenceMins: 5,
    params: { cadenceMins: null }, confirm: { cadenceMins: "CONFIRM-CLIENT-UPDATE-CADENCE" }, evaluate: ops.evaluateClientUpdateOverdue },
  { code: "ALR-CLI-03", name: "Compliance-sensitive entry raised", ownerTeam: TEAMS.txOps, severity: "critical", clock: "immediate", autoResolve: false,
    // TODO(CONFIRM-COMPLIANCE-ROUTE): route targets for Compliance.
    params: {} },
  { code: "ALR-CLI-04", name: "Client inbound threshold review overdue", ownerTeam: TEAMS.txOps, severity: "medium", clock: "12 months (CONFIRM)", ticketProject: "OPS", autoResolve: true, cadenceMins: 60, digest: true,
    params: { reviewMonths: 12 }, evaluate: ops.evaluateThresholdReview },
  { code: "ALR-TKT-01", name: "Unticketed work found", ownerTeam: TEAMS.txOps, severity: "high", clock: "08:30", autoResolve: false },
  { code: "ALR-TKT-02", name: "Ticket divergence", ownerTeam: TEAMS.txOps, severity: "medium", clock: "hourly", autoResolve: false },
  { code: "ALR-INCLOG-01", name: "INC draft overdue", ownerTeam: TEAMS.txOps, severity: "high", clock: "24h", ticketProject: "INC", autoResolve: false,
    params: { escalation: [{ afterMins: 0, notifyRole: "admin" }] } },
  { code: "ALR-VND-01", name: "Vendor ticket no update", ownerTeam: TEAMS.txOps, severity: "medium", clock: "CONFIRM", ticketProject: "VND", autoResolve: true, cadenceMins: 15,
    params: { businessHours: null }, confirm: { businessHours: "CONFIRM-VND-HOURS" }, evaluate: ops.evaluateVendorNoUpdate },
  { code: "ALR-AUD-01", name: "Audit outcome missing", ownerTeam: TEAMS.txOps, severity: "high", clock: "10 min grace", autoResolve: true,
    params: { graceMins: 10, lookbackHours: 72 }, evaluate: ops.evaluateAuditOutcomeMissing },
  // Internal security alerts (spec §17.7). TODO(CONFIRM-SEC-ROUTE): route to SecOps / the service owner once named.
  { code: "ALR-SEC-01", name: "Repeated authorisation failures", ownerTeam: TEAMS.txOps, severity: "high", clock: "N denials in window", autoResolve: true, cadenceMins: 5,
    params: { threshold: 10, windowMins: 15 }, evaluate: sec.evaluateRepeatedDenials },
  { code: "ALR-SEC-02", name: "Privileged configuration change", ownerTeam: TEAMS.txOps, severity: "medium", clock: "immediate (informational, ticketed)", autoResolve: false, cadenceMins: 5,
    params: { lookbackMins: 60 }, evaluate: sec.evaluatePrivilegedChange },
  { code: "ALR-SEC-03", name: "Export threshold exceeded", ownerTeam: TEAMS.txOps, severity: "high", clock: "immediate", autoResolve: false,
    params: {} },
  { code: "ALR-SEC-04", name: "Break-glass or non-SSO access used", ownerTeam: TEAMS.txOps, severity: "critical", clock: "immediate", autoResolve: false,
    params: {} },
  { code: "ALR-SEC-05", name: "Integration credential failure", ownerTeam: TEAMS.txOps, severity: "high", clock: "N failures in window", autoResolve: true, cadenceMins: 5,
    params: { threshold: 3, windowMins: 30 }, evaluate: sec.evaluateCredentialFailures },
  { code: "ALR-HB-SLACK", name: "Slack polling stopped", ownerTeam: TEAMS.txOps, severity: "critical", clock: "10 min, 24/7", autoResolve: true,
    params: { staleMins: 10 }, evaluate: ops.evaluateMessagePolling("slack") },
  { code: "ALR-HB-MAIL", name: "Mailbox polling stopped", ownerTeam: TEAMS.txOps, severity: "critical", clock: "10 min, 24/7", autoResolve: true,
    params: { staleMins: 10 }, evaluate: ops.evaluateMessagePolling("mail") },
  { code: "ALR-HB-SOURCE", name: "Heartbeat lost", ownerTeam: TEAMS.txOps, severity: "high", clock: "2 x expectedEveryMins per source", autoResolve: true,
    params: { staleRecordMins: { "custody_api.collateral": 24 * 60 } }, evaluate: ops.evaluateHeartbeats },
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
