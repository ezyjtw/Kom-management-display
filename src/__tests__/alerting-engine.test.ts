/**
 * Phase 6 acceptance (spec §11.5). For each engine-evaluated rule: positive
 * trigger, no trigger below threshold, dedupe, auto-resolve after two clean
 * runs (or stays open for rules that never auto-resolve), ticket created or
 * linked, and routing in and out of business hours. Frozen clocks
 * (vi.setSystemTime) and Komainu API snapshot fixtures in an in-memory store.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const db = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof import("@/__tests__/helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", async () => {
  const { createFakePrisma: make } = await import("@/__tests__/helpers/fake-prisma");
  db.client = make();
  return { prisma: db.client };
});

const envVars = vi.hoisted(() => ({
  ATLASSIAN_BASE_URL: "https://komainu.atlassian.net",
  ATLASSIAN_EMAIL: "svc@example.com",
  ATLASSIAN_API_TOKEN: "t",
  NEXTAUTH_URL: "https://kommand.example",
} as Record<string, string | undefined>));
vi.mock("@/lib/env", () => ({ env: (k: string) => envVars[k] }));
vi.mock("@/lib/http/allowed-hosts", () => ({ getAllowedHosts: () => new Set(["komainu.atlassian.net"]) }));
const flagState = vi.hoisted(() => ({ fab: true }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: vi.fn(async (k: string) => k === "module.fab" && flagState.fab) }));

const slack = vi.hoisted(() => ({
  posts: [] as Array<{ channel: string; text: string }>,
  users: { "lead@k.com": "U-LEAD", "settlements-lead@k.com": "U-LEAD", "primary@k.com": "U-PRIMARY", "backup@k.com": "U-BACKUP", "admin@k.com": "U-ADMIN" } as Record<string, string>,
}));
vi.mock("@/lib/integrations/slack", () => ({
  getSlackClient: () => ({
    chat: { postMessage: async (m: { channel: string; text: string }) => { slack.posts.push({ channel: m.channel, text: m.text }); return { ok: true }; } },
    users: { lookupByEmail: async ({ email }: { email: string }) => ({ user: slack.users[email] ? { id: slack.users[email] } : undefined }) },
  }),
}));
const emails = vi.hoisted(() => [] as Array<{ to: string; subject: string }>);
vi.mock("@/lib/integrations/email", () => ({ sendEmailNotification: async (to: string, subject: string) => { emails.push({ to, subject }); } }));

import { CircuitBreaker } from "@/lib/circuit-breaker";
import { runAlertEngine, syncRuleCatalogue } from "@/modules/alerting/engine";
import { RULE_CATALOGUE } from "@/modules/alerting/catalogue";
import { raiseAlert } from "@/modules/alerting/raise";
import { runEscalations, runAlertDigest } from "@/modules/alerting/routing";
import { businessMinutesWith, isBusinessTime, loadCalendar } from "@/modules/alerting/calendar";
import { SlackGxNotificationSource } from "@/modules/risk/signal-source";

type Row = Record<string, unknown>;
const p = () => db.client;

// ── Jira stub ──
const jira = { n: 0, comments: [] as Array<{ key: string; text: string }>, contacted: new Set<string>() };
function stubJira() {
  vi.stubGlobal("fetch", vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const path = url.pathname;
    if (method === "POST" && path === "/rest/api/3/issue") {
      const key = `${body.fields.project.key}-${++jira.n}`;
      return new Response(JSON.stringify({ id: String(jira.n), key }), { status: 201 });
    }
    const comment = /\/(?:rest\/api\/3\/issue|rest\/servicedeskapi\/request)\/([A-Z]+-\d+)\/comment$/.exec(path);
    if (method === "POST" && comment) {
      jira.comments.push({ key: comment[1], text: JSON.stringify(body) });
      return new Response(JSON.stringify({ id: "c" }), { status: 201 });
    }
    const issue = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)$/.exec(path);
    if (method === "GET" && issue) {
      return new Response(JSON.stringify({ key: issue[1], fields: { labels: jira.contacted.has(issue[1]) ? ["exchange-contacted"] : [], comment: { comments: [] } } }), { status: 200 });
    }
    return new Response("not stubbed", { status: 404 });
  }));
}

// ── Clock ──
const BUSINESS = new Date("2026-09-23T09:00:00Z"); // Wednesday 10:00 London
const OUT_OF_HOURS = new Date("2026-09-23T21:00:00Z"); // Wednesday 22:00 London
const mins = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

// ── Store helpers ──
async function add(model: string, data: Row) {
  return p()[model].create({ data });
}
async function komainu(kind: string, externalId: string, data: Row) {
  return add("sourceRecord", { source: "komainu_api", kind, externalId, ...data });
}
async function signal(externalId: string, fields: Row, at: Date) {
  return add("sourceRecord", { source: "gx", kind: "risk_signal", externalId, occurredAt: at, fields });
}
async function update(model: string, where: Row, data: Row) {
  await p()[model].updateMany({ where, data });
}

async function baseSeed() {
  await syncRuleCatalogue();
  for (const key of ["TOPS", "KPR", "AO", "VSR", "IAI"]) {
    await add("jiraProjectConfig", { key, name: key, kind: "jira", enabled: true, issueTypeIds: { _default: "10001" }, syncInbound: true, allowedCustomFields: [] });
  }
  await add("appSetting", { key: "alerts.defaultTicketProject", value: "TOPS" });
  await add("slackChannel", { channelId: "C-ALERTS", channelName: "alerts", channelType: "internal", purpose: "alerts_out", isActive: true });
  const lead = await add("employee", { name: "Lead", email: "lead@k.com", role: "Lead", team: "TransactionOperations", active: true });
  await add("employee", { name: "Settlements lead", email: "settlements-lead@k.com", role: "Lead", team: "Settlements", active: true });
  const primary = await add("employee", { name: "Primary", email: "primary@k.com", role: "Analyst", team: "TransactionOperations", active: true });
  const backup = await add("employee", { name: "Backup", email: "backup@k.com", role: "Analyst", team: "TransactionOperations", active: true });
  void lead;
  await add("user", { email: "admin@k.com", name: "Admin", role: "admin" });
  const day = new Date("2026-09-23T00:00:00Z");
  for (const team of ["Transaction Operations", "Admin Operations", "Staking Ops", "Settlements"]) {
    await add("onCallSchedule", { employeeId: primary.id, date: day, team, shiftType: "primary" });
    await add("onCallSchedule", { employeeId: backup.id, date: day, team, shiftType: "backup" });
  }
}

async function enable(code: string, params: Row = {}) {
  const rule = await p().alertRule.findUnique({ where: { code } });
  await update("alertRule", { code }, { enabled: true, params: { ...(rule!.params as Row), ...params } });
}

async function run(at: Date) {
  vi.setSystemTime(at);
  return runAlertEngine(at);
}

async function openAlerts(code: string) {
  return p().alert.findMany({ where: { ruleCode: code, status: { not: "resolved" } }, include: { workItem: true } });
}

// ── Scenarios (one per engine-evaluated rule) ──
interface Scenario {
  code: string;
  params?: Row;
  now?: Date;
  /** Seed data that triggers the rule at `now`; returns the expected dedupe key. */
  trigger: (now: Date) => Promise<string>;
  /** Seed data just below the threshold (no alert). */
  below: (now: Date) => Promise<void>;
  /** Make the condition clear. */
  clear: (now: Date) => Promise<void>;
}

const slaPolicy = () => add("slaPolicy", { id: "sla-p2", code: "CLIENT-Q-P2", description: "", ownershipMins: 60, firstRespMins: 120, resolveMins: 480, calendar: "24x7", warnAtPct: 50, breachEscalationRole: "lead", version: 1, isActive: true });
const clientRequest = async (startMinsAgo: number, now: Date) => {
  await slaPolicy();
  await add("workItem", { id: "wi-cr", kind: "client_request", title: "Where is my withdrawal?", taskCode: "CLIENT-Q", sourceSystem: "slack", sourceId: "C1:1", ticketKey: "CS-1", ticketSystem: "jsm", slaPolicyId: "sla-p2", clockStartedAt: mins(now, -startMinsAgo) });
  return "wi-cr";
};
const pendingRequest = (id: string, minsAgo: number, now: Date, fields: Row = {}) =>
  komainu("request", id, { status: "PENDING", occurredAt: mins(now, -minsAgo), fields: { type: "CREATE_TRANSACTION", organization: "Acme", workspace: "hot", ...fields } });
const oes01Alert = async (firedAt: Date, state = "owned") => {
  await add("workItem", { id: "wi-oes", kind: "oes_settlement", title: "Settlement failed", taskCode: "OES", sourceSystem: "alert", sourceId: "x", ticketKey: "TOPS-900", ticketSystem: "jira", state, exposureUsd: 500000, clockStartedAt: firedAt });
  await add("alert", { id: "al-oes", type: "ALR-OES-01", ruleCode: "ALR-OES-01", dedupeKey: "set-1", message: "Settlement failed", severity: "critical", workItemId: "wi-oes", firstFiredAt: firedAt, lastFiredAt: firedAt });
};

const fabInstruction = (data: Row) => add("fabInstruction", {
  messageType: "STL_INS", reference: "F-1", instructionType: "OPEN", direction: "RECEIVE", asset: "USDC", amount: 1000,
  valueDate: "2026-09-23", receivedAt: mins(BUSINESS, -45), ackStatus: "none", correctedByRef: null, notes: "", ...data,
});
const fabLog = (data: Row) => add("fabSettlementLog", { id: "log-7", reference: "F-1", status: "RECEIVED", kytStatus: "none", occurredAt: mins(BUSINESS, -10), notes: "", ...data });

const SCENARIOS: Scenario[] = [
  {
    code: "ALR-CLI-02",
    params: { cadenceMins: { P0: 30, P1: 60, P2: 240, P3: 480 } },
    trigger: async (now) => { await add("workItem", { id: "wi-ci", kind: "client_incident", title: "Client incident", taskCode: "CLIENT-INCIDENT", sourceSystem: "client_entry", sourceId: "ci-1", priority: "P1", ticketKey: "TOPS-501", ticketSystem: "jira", clientTicketKey: "CS-9", clockStartedAt: mins(now, -200), metadata: { lastClientUpdateAt: mins(now, -90).toISOString() } }); return "wi-ci"; },
    below: async (now) => { await add("workItem", { id: "wi-ci", kind: "client_incident", title: "Client incident", taskCode: "CLIENT-INCIDENT", sourceSystem: "client_entry", sourceId: "ci-1", priority: "P1", ticketKey: "TOPS-501", clientTicketKey: "CS-9", clockStartedAt: mins(now, -200), metadata: { lastClientUpdateAt: mins(now, -30).toISOString() } }); },
    clear: async (now) => update("workItem", { id: "wi-ci" }, { metadata: { lastClientUpdateAt: mins(now, 60).toISOString() } }),
  },
  {
    code: "ALR-HB-SLACK",
    trigger: async (now) => { await add("sourceHeartbeat", { source: "slack.channels", expectedEveryMins: 5, lastSuccessAt: mins(now, -11), lastCount: 0 }); return "slack.channels"; },
    below: async (now) => { await add("sourceHeartbeat", { source: "slack.channels", expectedEveryMins: 5, lastSuccessAt: mins(now, -6), lastCount: 0 }); },
    clear: async (now) => update("sourceHeartbeat", { source: "slack.channels" }, { lastSuccessAt: mins(now, 60) }),
  },
  {
    code: "ALR-HB-MAIL",
    trigger: async (now) => { await add("sourceHeartbeat", { source: "outlook.custody", expectedEveryMins: 5, lastSuccessAt: mins(now, -12), lastCount: 0 }); return "outlook.custody"; },
    below: async (now) => { await add("sourceHeartbeat", { source: "outlook.custody", expectedEveryMins: 5, lastSuccessAt: mins(now, -9), lastCount: 0 }); },
    clear: async (now) => update("sourceHeartbeat", { source: "outlook.custody" }, { lastSuccessAt: mins(now, 60) }),
  },
  {
    code: "ALR-UAT-02",
    trigger: async (now) => {
      await add("gxSprint", { id: "gx-1", sprint: "9.99", prodPlannedAt: mins(now, 24 * 60) });
      await add("gxChange", { sprintId: "gx-1", section: "S", itemType: "staking_change", summary: "x", detail: {}, rowHash: "h1", qualifies: true });
      return "9.99";
    },
    below: async (now) => {
      await add("gxSprint", { id: "gx-1", sprint: "9.99", prodPlannedAt: mins(now, 14 * 24 * 60) });
      await add("gxChange", { sprintId: "gx-1", section: "S", itemType: "staking_change", summary: "x", detail: {}, rowHash: "h1", qualifies: true });
    },
    clear: async () => update("gxChange", { sprintId: "gx-1" }, { uatOutcome: "pass" }),
  },
  {
    code: "ALR-HB-GXNOTES",
    trigger: async (now) => { await add("gxSprint", { sprint: "9.98", kmncKeys: ["KMNC-1"], createdAt: mins(now, -48 * 60) }); return "9.98"; },
    below: async (now) => { await add("gxSprint", { sprint: "9.98", kmncKeys: ["KMNC-1"], createdAt: mins(now, -60) }); },
    clear: async () => update("gxSprint", { sprint: "9.98" }, { pageVersion: 3 }),
  },
  {
    code: "ALR-AUD-01",
    trigger: async (now) => { await add("auditLog", { action: "work_item_state_changed", entityType: "work_item", entityId: "w", userId: "system", details: "{}", phase: "requested", correlationId: "c1", createdAt: mins(now, -15) }); return "audit-outcome-missing"; },
    below: async (now) => { await add("auditLog", { action: "work_item_state_changed", entityType: "work_item", entityId: "w", userId: "system", details: "{}", phase: "requested", correlationId: "c1", createdAt: mins(now, -5) }); },
    clear: async () => { await add("auditLog", { action: "work_item_state_changed", entityType: "work_item", entityId: "w", userId: "system", details: "{}", phase: "completed", correlationId: "c1" }); },
  },
  {
    code: "ALR-CLI-04",
    trigger: async () => { await add("client", { id: "cl-1", displayName: "Acme", isActive: true, inboundThresholdUsd: 10000, thresholdReviewedAt: new Date("2025-01-10T00:00:00Z") }); return "cl-1"; },
    below: async () => { await add("client", { id: "cl-1", displayName: "Acme", isActive: true, inboundThresholdUsd: 10000, thresholdReviewedAt: new Date("2026-06-01T00:00:00Z") }); },
    clear: async (now) => update("client", { id: "cl-1" }, { thresholdReviewedAt: now }),
  },
  {
    code: "ALR-FAB-01",
    trigger: async () => { await fabInstruction({ sourceMessageId: "<m1@fab>" }); return "<m1@fab>"; },
    below: async () => { await fabInstruction({ ackStatus: "ACK" }); },
    clear: async () => update("fabInstruction", { reference: "F-1" }, { ackStatus: "ACK" }),
  },
  {
    code: "ALR-FAB-02",
    params: { ackMins: 30 },
    trigger: async (now) => { await fabInstruction({ receivedAt: mins(now, -45) }); return "F-1"; },
    below: async (now) => { await fabInstruction({ receivedAt: mins(now, -10) }); },
    clear: async () => update("fabInstruction", { reference: "F-1" }, { ackStatus: "NACK" }),
  },
  {
    code: "ALR-FAB-03",
    trigger: async () => { await fabInstruction({ receivedAt: new Date("2026-09-22T15:30:00Z") }); return "F-1"; }, // 16:30 London
    below: async () => { await fabInstruction({ receivedAt: new Date("2026-09-22T13:00:00Z") }); }, // 14:00 London
    clear: async () => update("fabInstruction", { reference: "F-1" }, { receivedAt: new Date("2026-09-22T13:00:00Z") }),
  },
  {
    code: "ALR-FAB-04",
    trigger: async () => { await fabInstruction({ ackStatus: "NACK" }); return "F-1"; },
    below: async () => { await fabInstruction({ ackStatus: "ACK" }); },
    clear: async () => update("fabInstruction", { reference: "F-1" }, { correctedByRef: "F-2" }),
  },
  {
    code: "ALR-FAB-05",
    trigger: async () => { await fabInstruction({ ackStatus: "ACK" }); await fabLog({ status: "FAILED" }); return "F-1"; },
    below: async () => { await fabInstruction({ ackStatus: "ACK" }); await fabLog({ status: "COMPLETED" }); },
    clear: async () => update("fabSettlementLog", { id: "log-7" }, { status: "COMPLETED" }),
  },
  {
    code: "ALR-FAB-06",
    params: { valueDateCutoffLocal: "09:30" }, // BUSINESS is 10:00 London
    trigger: async () => { await fabInstruction({ ackStatus: "ACK" }); return "F-1"; },
    below: async () => { await fabInstruction({ ackStatus: "ACK" }); await fabLog({ status: "RECEIVED" }); },
    clear: async () => { await fabLog({ status: "RECEIVED" }); },
  },
  {
    code: "ALR-FAB-07",
    trigger: async () => { await fabInstruction({ ackStatus: "ACK" }); await fabLog({ kytStatus: "fail" }); return "log-7"; },
    below: async () => { await fabInstruction({ ackStatus: "ACK" }); await fabLog({ kytStatus: "none" }); },
    clear: async () => update("fabSettlementLog", { id: "log-7" }, { kytStatus: "cleared" }),
  },
  {
    code: "ALR-FAB-08",
    params: { thresholds: { ETH: 1 } },
    trigger: async (now) => { await add("fabFeeBalance", { walletRef: "fee-1", asset: "ETH", balance: 0.5, recordedAt: mins(now, -5) }); return "fee-1"; },
    below: async (now) => { await add("fabFeeBalance", { walletRef: "fee-1", asset: "ETH", balance: 2, recordedAt: mins(now, -5) }); },
    clear: async (now) => { await add("fabFeeBalance", { walletRef: "fee-1", asset: "ETH", balance: 3, recordedAt: mins(now, 1) }); },
  },
  {
    code: "ALR-OES-01",
    trigger: async (now) => { await komainu("settlement", "set-1", { status: "FAILED", mappedStatus: "failed", occurredAt: mins(now, -30), fields: { exchange: "okx" } }); return "set-1"; },
    below: async (now) => { await komainu("settlement", "set-1", { status: "DONE", mappedStatus: "completed", occurredAt: mins(now, -30) }); },
    clear: async () => update("sourceRecord", { externalId: "set-1" }, { mappedStatus: "completed" }),
  },
  {
    code: "ALR-OES-02",
    trigger: async (now) => { await komainu("settlement", "set-2", { status: "RUNNING", mappedStatus: "in_progress", occurredAt: mins(now, -61) }); return "set-2"; },
    below: async (now) => { await komainu("settlement", "set-2", { status: "RUNNING", mappedStatus: "in_progress", occurredAt: mins(now, -30) }); },
    clear: async () => update("sourceRecord", { externalId: "set-2" }, { mappedStatus: "completed" }),
  },
  {
    code: "ALR-OES-03",
    now: new Date("2026-09-23T09:45:00Z"),
    trigger: async () => {
      await add("oesWindow", { exchange: "okx", cron: "0 9 * * *", durationMins: 30, referenceTz: "UTC", isActive: true });
      await komainu("portfolio", "pf-1", { status: "ACTIVE", fields: { exchange: "okx", type: "OES" } });
      return "pf-1:2026-09-23T09:00:00.000Z";
    },
    below: async () => {
      await add("oesWindow", { exchange: "okx", cron: "0 9 * * *", durationMins: 30, referenceTz: "UTC", isActive: true });
      await komainu("portfolio", "pf-1", { status: "ACTIVE", fields: { exchange: "okx", type: "OES" } });
      await komainu("settlement", "set-3", { status: "DONE", mappedStatus: "completed", occurredAt: new Date("2026-09-23T09:05:00Z"), fields: { portfolio_id: "pf-1", exchange: "okx" } });
    },
    clear: async () => { await komainu("settlement", "set-3", { status: "DONE", mappedStatus: "completed", occurredAt: new Date("2026-09-23T09:50:00Z"), fields: { portfolio_id: "pf-1", exchange: "okx" } }); },
  },
  {
    code: "ALR-OES-04",
    trigger: async (now) => { await pendingRequest("req-4", 20, now, { type: "COLLATERAL_OPERATION_OFFCHAIN" }); return "req-4"; },
    below: async (now) => { await pendingRequest("req-4", 5, now, { type: "COLLATERAL_OPERATION_OFFCHAIN" }); },
    clear: async () => update("sourceRecord", { externalId: "req-4" }, { status: "APPROVED" }),
  },
  {
    code: "ALR-OES-05",
    trigger: async (now) => { await oes01Alert(mins(now, -130)); return "al-oes"; },
    below: async (now) => { await oes01Alert(mins(now, -60)); },
    clear: async () => { jira.contacted.add("TOPS-900"); },
  },
  {
    code: "ALR-OES-06",
    now: new Date("2026-09-23T16:30:00Z"), // 17:30 London
    trigger: async () => { await oes01Alert(new Date("2026-09-23T08:00:00Z")); return "set-1"; },
    below: async () => { await oes01Alert(new Date("2026-09-23T08:00:00Z"), "closed"); },
    clear: async () => update("alert", { id: "al-oes" }, { status: "resolved" }),
  },
  {
    code: "ALR-OES-07",
    trigger: async (now) => { await komainu("collateral_operation", "op-7", { status: "FAILED", mappedStatus: "failed", occurredAt: mins(now, -10) }); return "op-7"; },
    below: async (now) => { await komainu("collateral_operation", "op-7", { status: "DONE", mappedStatus: "completed", occurredAt: mins(now, -10) }); },
    clear: async () => update("sourceRecord", { externalId: "op-7" }, { mappedStatus: "completed" }),
  },
  {
    code: "ALR-RSK-01",
    params: { pendingMins: 30 },
    trigger: async (now) => { await pendingRequest("req-r1", 40, now); await signal("s1", { requestId: "req-r1", level: "medium", rules: [], reasons: ["velocity"] }, mins(now, -39)); return "req-r1"; },
    below: async (now) => { await pendingRequest("req-r1", 10, now); await signal("s1", { requestId: "req-r1", level: "medium", rules: [], reasons: [] }, mins(now, -9)); },
    clear: async () => update("sourceRecord", { externalId: "req-r1" }, { status: "APPROVED" }),
  },
  {
    code: "ALR-RSK-02",
    params: { pendingMins: 30 },
    // GX said low, but rule 7 is High under the current approved flow (RiskRuleTier).
    trigger: async (now) => { await add("riskRuleTier", { rule: 7, tier: "high" }); await pendingRequest("req-r2", 40, now); await signal("s2", { requestId: "req-r2", level: "low", rules: [7], reasons: ["new address"] }, mins(now, -39)); return "req-r2"; },
    below: async (now) => { await add("riskRuleTier", { rule: 7, tier: "high" }); await pendingRequest("req-r2", 10, now); await signal("s2", { requestId: "req-r2", level: "low", rules: [7], reasons: [] }, mins(now, -9)); },
    clear: async () => update("sourceRecord", { externalId: "req-r2" }, { status: "APPROVED" }),
  },
  {
    code: "ALR-RSK-03",
    trigger: async (now) => { await pendingRequest("req-r3", 1, now); await signal("s3", { requestId: "req-r3", level: "requires_escalation", rules: [], reasons: [] }, now); return "req-r3"; },
    below: async (now) => { await pendingRequest("req-r3", 1, now); await signal("s3", { requestId: "req-r3", level: "medium", rules: [], reasons: [] }, now); },
    clear: async () => update("sourceRecord", { externalId: "req-r3" }, { status: "REJECTED" }),
  },
  {
    code: "ALR-RSK-04",
    trigger: async (now) => { await signal("s4", { rules: [12], reasons: ["Emergency stop"], scope: "client-a", level: "high" }, mins(now, -5)); return "client-a"; },
    below: async (now) => { await signal("s4", { rules: [3], reasons: [], scope: "client-a", level: "high" }, mins(now, -5)); },
    clear: async (now) => { await signal("s4b", { rules: [12], reasons: ["cleared"], scope: "client-a", level: "high", cleared: true }, mins(now, -1)); },
  },
  {
    code: "ALR-RSK-05",
    trigger: async (now) => { await pendingRequest("req-r5", 5, now); await signal("s5", { requestId: "req-r5", level: "high", rules: [], reasons: ["No Rule configurations found for the Risk Check"] }, mins(now, -5)); return "Acme:risk_check"; },
    below: async (now) => { await pendingRequest("req-r5", 5, now); await signal("s5", { requestId: "req-r5", level: "high", rules: [], reasons: ["velocity"] }, mins(now, -5)); },
    clear: async () => update("sourceRecord", { externalId: "s5" }, { fields: { requestId: "req-r5", level: "high", rules: [], reasons: ["fixed"] } }),
  },
  {
    code: "ALR-RSK-06",
    trigger: async (now) => { await komainu("transaction", "tx-6", { status: "BROADCASTED", occurredAt: mins(now, -20) }); await signal("s6", { transactionId: "tx-6", level: "high", rules: [5], reasons: ["KYT"] }, mins(now, -5)); return "tx-6"; },
    below: async (now) => { await komainu("transaction", "tx-6", { status: "PENDING", occurredAt: mins(now, -20) }); await signal("s6", { transactionId: "tx-6", level: "high", rules: [5], reasons: ["KYT"] }, mins(now, -5)); },
    clear: async () => update("sourceRecord", { externalId: "s6" }, { fields: { transactionId: "tx-6", level: "high", rules: [1], reasons: [] } }),
  },
  {
    code: "ALR-RSK-07",
    trigger: async (now) => { await pendingRequest("req-r7", 15, now); await signal("s7", { requestId: "req-r7", level: "low", rules: [], reasons: [] }, mins(now, -14)); return "req-r7"; },
    below: async (now) => { await pendingRequest("req-r7", 5, now); await signal("s7", { requestId: "req-r7", level: "low", rules: [], reasons: [] }, mins(now, -4)); },
    clear: async () => update("sourceRecord", { externalId: "req-r7" }, { status: "APPROVED" }),
  },
  {
    code: "ALR-RSK-08",
    params: { pendingMins: 30, excludedWorkspaces: ["cold-1"] },
    trigger: async (now) => { await pendingRequest("req-r8", 40, now, { workspace: "cold-1" }); return "req-r8"; },
    below: async (now) => { await pendingRequest("req-r8", 40, now, { workspace: "hot" }); },
    clear: async () => update("sourceRecord", { externalId: "req-r8" }, { status: "APPROVED" }),
  },
  {
    code: "ALR-RSK-09",
    params: { pendingMins: 30 },
    trigger: async (now) => { await pendingRequest("req-r9", 40, now, { transactionType: "STAKE" }); return "req-r9"; },
    below: async (now) => { await pendingRequest("req-r9", 10, now, { transactionType: "STAKE" }); },
    clear: async () => update("sourceRecord", { externalId: "req-r9" }, { status: "APPROVED" }),
  },
  {
    code: "ALR-CFG-01",
    params: { eventPatterns: ["whitelist", "tap[_ ]rule"] },
    trigger: async (now) => { await komainu("audit_log", "au-1", { status: "ADMINISTRATION", occurredAt: mins(now, -5), fields: { event: "WHITELIST_ADDRESS_ADDED" } }); return "au-1"; },
    below: async (now) => { await komainu("audit_log", "au-1", { status: "ADMINISTRATION", occurredAt: mins(now, -5), fields: { event: "USER_LOGIN" } }); },
    clear: async () => update("sourceRecord", { externalId: "au-1" }, { fields: { event: "USER_LOGIN" } }),
  },
  {
    code: "ALR-KPS-01",
    trigger: async (now) => { await add("workItem", { id: "wi-kps", kind: "kps_case", title: "K4 realisation", taskCode: "KPS", sourceSystem: "jira", sourceId: "KPR-1", ticketKey: "KPR-1", ticketSystem: "jira", exposureUsd: 2_000_000, clockStartedAt: now }); return "wi-kps"; },
    below: async (now) => { await add("workItem", { id: "wi-kps", kind: "kps_case", title: "K4 realisation", taskCode: "KPS", sourceSystem: "jira", sourceId: "KPR-1", ticketKey: "KPR-1", exposureUsd: 500_000, clockStartedAt: now }); },
    clear: async () => { await add("ticketLink", { workItemId: "wi-kps", system: "jira", key: "RISKCO-1", url: "https://x/RISKCO-1", role: "riskco_approval" }); },
  },
  {
    code: "ALR-TX-01",
    trigger: async (now) => { await komainu("transaction", "tx-1", { status: "FAILED", occurredAt: mins(now, -10), fields: { asset: "ETH" } }); return "tx-1"; },
    below: async (now) => { await komainu("transaction", "tx-1", { status: "PENDING", occurredAt: mins(now, -10), fields: { asset: "ETH" } }); },
    clear: async () => update("sourceRecord", { externalId: "tx-1" }, { status: "CONFIRMED" }),
  },
  {
    code: "ALR-TX-02",
    trigger: async (now) => { await add("assetThreshold", { asset: "BTC", stuckMins: 60 }); await komainu("transaction", "tx-2", { status: "PENDING", occurredAt: mins(now, -90), fields: { asset: "BTC" } }); return "tx-2"; },
    below: async (now) => { await add("assetThreshold", { asset: "BTC", stuckMins: 60 }); await komainu("transaction", "tx-2", { status: "PENDING", occurredAt: mins(now, -30), fields: { asset: "BTC" } }); },
    clear: async () => update("sourceRecord", { externalId: "tx-2" }, { status: "CONFIRMED" }),
  },
  {
    code: "ALR-TR-01",
    trigger: async (now) => { await add("travelRuleCase", { id: "tr-1", transactionId: "t", direction: "IN", asset: "BTC", amount: 1, matchStatus: "unmatched", status: "Open", createdAt: mins(now, -30 * 60) }); return "tr-1"; },
    below: async (now) => { await add("travelRuleCase", { id: "tr-1", transactionId: "t", direction: "IN", asset: "BTC", amount: 1, matchStatus: "unmatched", status: "Open", createdAt: mins(now, -10 * 60) }); },
    clear: async () => update("travelRuleCase", { id: "tr-1" }, { status: "Resolved" }),
  },
  { code: "ALR-SLA-01", trigger: async (now) => clientRequest(40, now), below: async (now) => { await clientRequest(10, now); }, clear: async (now) => update("workItem", { id: "wi-cr" }, { ownedAt: now }) },
  { code: "ALR-SLA-02", trigger: async (now) => clientRequest(70, now), below: async (now) => { await clientRequest(40, now); }, clear: async (now) => update("workItem", { id: "wi-cr" }, { ownedAt: now }) },
  { code: "ALR-SLA-03", trigger: async (now) => clientRequest(70, now), below: async (now) => { await clientRequest(30, now); }, clear: async (now) => update("workItem", { id: "wi-cr" }, { firstResponseAt: now }) },
  { code: "ALR-SLA-04", trigger: async (now) => clientRequest(130, now), below: async (now) => { await clientRequest(70, now); }, clear: async (now) => update("workItem", { id: "wi-cr" }, { firstResponseAt: now }) },
  { code: "ALR-SLA-05", trigger: async (now) => clientRequest(300, now), below: async (now) => { await clientRequest(100, now); }, clear: async (now) => update("workItem", { id: "wi-cr" }, { resolvedAt: now }) },
  { code: "ALR-SLA-06", trigger: async (now) => clientRequest(500, now), below: async (now) => { await clientRequest(300, now); }, clear: async (now) => update("workItem", { id: "wi-cr" }, { resolvedAt: now }) },
  {
    code: "ALR-CHK-01",
    trigger: async () => { await add("dailyCheckDefinition", { code: "CHK-01", name: "Stuck transactions", team: "Team 1", frequency: "daily", dueByLocal: "09:05", evidenceSpec: {}, ticketProject: "TOPS", confluenceUrl: "", isActive: true }); return "CHK-01:2026-09-23"; },
    below: async () => { await add("dailyCheckDefinition", { code: "CHK-01", name: "Stuck transactions", team: "Team 1", frequency: "daily", dueByLocal: "23:00", evidenceSpec: {}, ticketProject: "TOPS", confluenceUrl: "", isActive: true }); },
    clear: async () => { await add("dailyCheckItem", { runId: "r", name: "Stuck", category: "stuck_tx", definitionCode: "CHK-01", periodKey: "2026-09-23", status: "pass" }); },
  },
  {
    code: "ALR-VND-01",
    params: { businessHours: 4 },
    trigger: async (now) => { await add("workItem", { id: "wi-v", kind: "vendor_ticket", title: "Vendor issue", taskCode: "VENDOR", sourceSystem: "jira", sourceId: "VSR-1", ticketKey: "VSR-1", ticketSystem: "jira", clockStartedAt: new Date("2026-09-21T07:00:00Z"), metadata: { lastVendorUpdateAt: "2026-09-21T08:00:00Z" } }); void now; return "wi-v"; },
    below: async (now) => { await add("workItem", { id: "wi-v", kind: "vendor_ticket", title: "Vendor issue", taskCode: "VENDOR", sourceSystem: "jira", sourceId: "VSR-1", ticketKey: "VSR-1", clockStartedAt: mins(now, -60), metadata: { lastVendorUpdateAt: mins(now, -60).toISOString() } }); },
    clear: async (now) => update("workItem", { id: "wi-v" }, { metadata: { lastVendorUpdateAt: mins(now, 60).toISOString() } }),
  },
  {
    code: "ALR-HB-SOURCE",
    trigger: async (now) => { await add("sourceHeartbeat", { source: "komainu_api.requests", expectedEveryMins: 1, lastSuccessAt: mins(now, -5), lastCount: 0 }); return "komainu_api.requests"; },
    below: async (now) => { await add("sourceHeartbeat", { source: "komainu_api.requests", expectedEveryMins: 1, lastSuccessAt: mins(now, -1), lastCount: 0 }); },
    clear: async (now) => update("sourceHeartbeat", { source: "komainu_api.requests" }, { lastSuccessAt: mins(now, 120) }),
  },
];

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BUSINESS);
  p().__reset();
  CircuitBreaker.resetAll();
  slack.posts.length = 0;
  emails.length = 0;
  jira.n = 0;
  jira.comments.length = 0;
  jira.contacted.clear();
  stubJira();
  await baseSeed();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const oes01 = SCENARIOS.find((x) => x.code === "ALR-OES-01")!;

describe("catalogue", () => {
  it("covers every evaluated rule with a scenario", () => {
    const evaluated = Object.values(RULE_CATALOGUE).filter((d) => d.evaluate).map((d) => d.code).sort();
    expect(SCENARIOS.map((s) => s.code).sort()).toEqual(evaluated);
  });

  it("syncs every rule disabled, each with an owner team, a clock and an escalation step", async () => {
    const rules = await p().alertRule.findMany();
    expect(rules.length).toBe(Object.keys(RULE_CATALOGUE).length);
    expect(rules.every((r) => r.enabled === false)).toBe(true);
    for (const def of Object.values(RULE_CATALOGUE)) {
      expect(def.ownerTeam).toBeTruthy();
      expect(def.clock).toBeTruthy();
      expect(Array.isArray(def.params.escalation) && (def.params.escalation as unknown[]).length).toBeGreaterThan(0);
    }
  });

  it("does not evaluate disabled rules", async () => {
    await oes01.trigger(BUSINESS);
    const out = await run(BUSINESS);
    expect(out.evaluated).toEqual([]);
    expect(await p().alert.count()).toBe(0);
  });
});

describe.each(SCENARIOS)("$code", (s) => {
  const def = RULE_CATALOGUE[s.code];
  const cadence = def.cadenceMins ?? 1;
  const now = s.now ?? BUSINESS;

  beforeEach(async () => {
    await enable(s.code, s.params);
  });

  it("fires on a positive trigger and creates or links the ticket", async () => {
    const key = await s.trigger(now);
    await run(now);
    const open = await openAlerts(s.code);
    expect(open.map((a) => a.dedupeKey)).toEqual([key]);
    const wi = open[0].workItem as Row | null;
    expect(wi?.ticketKey).toBeTruthy();
  });

  it("does not fire below the threshold", async () => {
    await s.below(now);
    await run(now);
    expect(await openAlerts(s.code)).toHaveLength(0);
  });

  it("dedupes repeated evaluations into one alert", async () => {
    await s.trigger(now);
    await run(now);
    await run(mins(now, cadence));
    const all = await p().alert.findMany({ where: { ruleCode: s.code } });
    expect(all).toHaveLength(1);
    expect(all[0].fireCount).toBe(1);
  });

  it(def.autoResolve ? "auto-resolves after two clean runs and comments on the ticket" : "never auto-resolves", async () => {
    await s.trigger(now);
    await run(now);
    await s.clear(now);
    await run(mins(now, cadence));
    expect(await openAlerts(s.code)).toHaveLength(1); // one clean run is not enough
    jira.comments.length = 0;
    await run(mins(now, 2 * cadence));
    const open = await openAlerts(s.code);
    if (def.autoResolve) {
      expect(open).toHaveLength(0);
      const resolved = await p().alert.findFirst({ where: { ruleCode: s.code } });
      expect(resolved!.autoResolvedAt).toBeInstanceOf(Date);
      expect(jira.comments.some((c) => c.text.includes("condition cleared at"))).toBe(true);
    } else {
      expect(open).toHaveLength(1);
    }
  });

  it("routes in business hours to alerts_out (mentioning the lead for high/critical) and out of hours to the on-call primary", async () => {
    await s.trigger(now);
    await run(now);
    const [alert] = await openAlerts(s.code);
    if (def.digest && alert.severity === "medium") {
      expect(slack.posts).toHaveLength(0); // goes to the daily digest
      return;
    }
    const business = await isBusinessTime("business_uk", now);
    if (business) {
      const post = slack.posts.find((m) => m.channel === "C-ALERTS");
      expect(post?.text).toContain(s.code);
      if (alert.severity === "high" || alert.severity === "critical") expect(post?.text).toContain("<@U-LEAD>");
    }

    // Same condition raised fresh out of hours.
    p().__reset();
    slack.posts.length = 0;
    emails.length = 0;
    await baseSeed();
    await enable(s.code, s.params);
    const ooh = s.now && s.now > OUT_OF_HOURS ? s.now : OUT_OF_HOURS;
    await s.trigger(ooh);
    await run(ooh);
    expect(slack.posts.some((m) => m.channel === "C-ALERTS")).toBe(false);
    expect(slack.posts.some((m) => m.channel === "U-PRIMARY" && m.text.includes(s.code))).toBe(true);
    expect(emails.some((e) => e.to === "primary@k.com")).toBe(true);
  });
});

describe("routing and escalation", () => {
  it("never re-notifies the same alert within 15 minutes, but counts the firing", async () => {
    await enable("ALR-TKT-02");
    await raiseAlert({ ruleCode: "ALR-TKT-02", dedupeKey: "reconcile", message: "divergence" });
    vi.setSystemTime(mins(BUSINESS, 5));
    await raiseAlert({ ruleCode: "ALR-TKT-02", dedupeKey: "reconcile", message: "divergence" });
    expect(slack.posts.filter((m) => m.channel === "C-ALERTS")).toHaveLength(1);
    const [a] = await p().alert.findMany({ where: { ruleCode: "ALR-TKT-02" } });
    expect(a.fireCount).toBe(2);

    vi.setSystemTime(mins(BUSINESS, 16));
    await raiseAlert({ ruleCode: "ALR-TKT-02", dedupeKey: "reconcile", message: "divergence" });
    expect(slack.posts.filter((m) => m.channel === "C-ALERTS")).toHaveLength(2);
    expect(jira.comments.some((c) => c.text.includes("fired again"))).toBe(true);
  });

  it("walks the escalation ladder for unacknowledged alerts", async () => {
    await enable("ALR-OES-01");
    await oes01.trigger(BUSINESS);
    await run(BUSINESS);
    emails.length = 0;
    await runEscalations(mins(BUSINESS, 10));
    expect(emails).toHaveLength(0);
    await runEscalations(mins(BUSINESS, 15)); // critical: lead at 15 min
    expect(emails.map((e) => e.to)).toEqual(["lead@k.com"]);
    await runEscalations(mins(BUSINESS, 61)); // then admin at 60 min
    expect(emails.map((e) => e.to)).toEqual(["lead@k.com", "admin@k.com"]);
    await runEscalations(mins(BUSINESS, 90));
    expect(emails).toHaveLength(2); // each step once
  });

  it("out of hours, a critical alert not acknowledged in 15 minutes goes to the secondary and the lead", async () => {
    await enable("ALR-OES-01", { escalation: [] });
    await oes01.trigger(OUT_OF_HOURS);
    await run(OUT_OF_HOURS);
    emails.length = 0;
    await runEscalations(mins(OUT_OF_HOURS, 14));
    expect(emails).toHaveLength(0);
    await runEscalations(mins(OUT_OF_HOURS, 15));
    expect(emails.map((e) => e.to).sort()).toEqual(["backup@k.com", "lead@k.com"]);
    await runEscalations(mins(OUT_OF_HOURS, 30));
    expect(emails).toHaveLength(2);
  });

  it("does not escalate acknowledged alerts", async () => {
    await enable("ALR-OES-01");
    await oes01.trigger(BUSINESS);
    await run(BUSINESS);
    await update("alert", { ruleCode: "ALR-OES-01" }, { status: "acknowledged" });
    emails.length = 0;
    await runEscalations(mins(BUSINESS, 120));
    expect(emails).toHaveLength(0);
  });

  it("posts digest rules once a day", async () => {
    await enable("ALR-CFG-02");
    await raiseAlert({ ruleCode: "ALR-CFG-02", dedupeKey: "settlement:WEIRD", message: "Unmapped status WEIRD" });
    expect(slack.posts).toHaveLength(0);
    const out = await runAlertDigest(new Date("2026-09-24T07:00:00Z"));
    expect(out.alerts).toBe(1);
    expect(slack.posts[0].text).toContain("Unmapped status WEIRD");
    expect((await runAlertDigest(new Date("2026-09-24T07:05:00Z"))).alerts).toBe(0);
  });

  it("does not auto-resolve when an evaluator fails", async () => {
    await enable("ALR-OES-01");
    await oes01.trigger(BUSINESS);
    await run(BUSINESS);
    const spy = vi.spyOn(RULE_CATALOGUE["ALR-OES-01"], "evaluate").mockRejectedValue(new Error("db down"));
    await run(mins(BUSINESS, 1));
    await run(mins(BUSINESS, 2));
    spy.mockRestore();
    expect(await openAlerts("ALR-OES-01")).toHaveLength(1);
  });

  it("skips an enabled rule whose CONFIRM params are unset", async () => {
    await update("alertRule", { code: "ALR-RSK-01" }, { enabled: true });
    const out = await run(BUSINESS);
    expect(out.skipped).toEqual([{ code: "ALR-RSK-01", reason: "missing pendingMins (CONFIRM-RSK-MED-MINS)" }]);
  });
});

describe("FAB module flag", () => {
  it("evaluates no FAB rule while module.fab is off", async () => {
    flagState.fab = false;
    try {
      await enable("ALR-FAB-01");
      await fabInstruction({});
      await run(BUSINESS);
      expect(await openAlerts("ALR-FAB-01")).toHaveLength(0);
    } finally {
      flagState.fab = true;
    }
  });
});

describe("risk signal source (§11.4)", () => {
  it("fails safe: unparsed GX posts raise an alert instead of being dropped", async () => {
    await enable("ALR-CFG-02");
    await add("sourceRecord", { source: "slack", kind: "risk_signal_raw", externalId: "C-GX:1", firstSeenAt: BUSINESS, fields: { text: "Risk: something" } });
    const signals = await new SlackGxNotificationSource().poll(mins(BUSINESS, -60));
    expect(signals).toEqual([]);
    const [a] = await p().alert.findMany({ where: { ruleCode: "ALR-CFG-02" } });
    expect(a.message).toMatch(/Unparsed GX risk notification/);
    expect((await p().sourceRecord.findFirst({ where: { externalId: "C-GX:1" } }))!.status).toBe("unparsed");
  });
});

describe("business calendar", () => {
  it("counts business minutes over a weekend and a public holiday", async () => {
    await add("publicHoliday", { date: new Date("2026-09-28T00:00:00Z"), name: "Test holiday", region: "Global" });
    const cal = await loadCalendar("business_uk", new Date("2026-09-25T00:00:00Z"), new Date("2026-09-30T00:00:00Z"));
    // Fri 17:00 London -> Tue 09:00 London: 1h Fri + (Mon holiday) + 1h Tue.
    expect(businessMinutesWith(cal, new Date("2026-09-25T16:00:00Z"), new Date("2026-09-29T08:00:00Z"))).toBe(120);
    expect(await isBusinessTime("business_uk", BUSINESS)).toBe(true);
    expect(await isBusinessTime("business_uk", OUT_OF_HOURS)).toBe(false);
    expect(await isBusinessTime("24x7", OUT_OF_HOURS)).toBe(true);
  });
});
