/**
 * Phase 5 acceptance (spec §10.5): one test per §10.2 rule (422 with a clear
 * message), automatic tickets (§10.1), and the unticketed report on fixtures.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const envVars = vi.hoisted(() => ({
  ATLASSIAN_BASE_URL: "https://example.atlassian.net",
  ATLASSIAN_EMAIL: "svc@example.com",
  ATLASSIAN_API_TOKEN: "t",
} as Record<string, string | undefined>));
vi.mock("@/lib/env", () => ({ env: (k: string) => envVars[k] }));
vi.mock("@/lib/http/allowed-hosts", () => ({ getAllowedHosts: () => new Set(["example.atlassian.net"]) }));
vi.mock("@/lib/integrations/slack", () => ({ getSlackClient: () => null }));

const flags = vi.hoisted(() => ({ incidentLog: false }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: vi.fn(async (k: string) => (k === "incident_log.drafts.enabled" ? flags.incidentLog : false)) }));

const p = vi.hoisted(() => {
  const model = () => ({
    findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(async (_args?: unknown): Promise<unknown[]> => []), create: vi.fn(), update: vi.fn(),
    upsert: vi.fn(), count: vi.fn(async () => 0), deleteMany: vi.fn(),
  });
  return {
    appSetting: model(), workItem: model(), timeLog: model(), alert: model(), alertRule: model(), jiraProjectConfig: model(),
    ticketLink: model(), dailyCheckItem: model(), dailyCheckRun: model(), sourceRecord: model(), commsThread: model(),
    incidentLogDraft: model(), auditLog: model(), slackChannel: model(), employee: model(), userClientScope: model(),
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: p }));

const authState = vi.hoisted(() => ({ user: { id: "u1", name: "Op", email: "op@k.com", role: "employee", employeeId: "emp-1", team: null } as Record<string, unknown> }));
vi.mock("@/lib/auth-user", () => ({ requireAuth: vi.fn(async () => authState.user) }));
vi.mock("@/lib/api/rate-limit-middleware", () => ({ checkRateLimit: () => null, RATE_LIMIT_PRESETS: { mutation: {} } }));

import { CircuitBreaker } from "@/lib/circuit-breaker";
import { POST as closeRoute } from "@/app/api/work-items/[id]/close/route";
import { POST as ackRoute } from "@/app/api/alerts/[id]/acknowledge/route";
import { PATCH as commsAlertsPatch } from "@/app/api/comms/alerts/route";
import { PATCH as dailyPatch } from "@/app/api/daily-checks/route";
import { POST as exceptionsRoute } from "@/app/api/daily-checks/items/[id]/exceptions/route";
import { POST as approveSkipRoute } from "@/app/api/daily-checks/items/[id]/skip-signoff/route";
import { ensureAlertTicket } from "@/modules/work-items/tickets";
import { buildUnticketedReport, runUnticketedReport, reconcileTickets } from "@/modules/work-items/ticket-jobs";
import { createIncidentLogDraft } from "@/modules/incident-log/drafts";
import { getNextCronRun } from "@/lib/background-jobs";

type Call = { method: string; path: string; body: unknown };
let calls: Call[] = [];
function stubJira(handler: (c: Call) => Response) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(input.toString());
    const c = { method: init?.method ?? "GET", path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(c);
    return handler(c);
  }));
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  for (const m of Object.values(p)) {
    if (typeof m === "object") {
      m.findMany.mockResolvedValue([]);
      m.count.mockResolvedValue(0);
    }
  }
  CircuitBreaker.resetAll();
  authState.user = { id: "u1", name: "Op", email: "op@k.com", role: "employee", employeeId: "emp-1", team: null };
  flags.incidentLog = false;
  p.appSetting.findUnique.mockResolvedValue(null);
  p.$transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops));
  stubJira(() => new Response(null, { status: 204 }));
});
afterEach(() => vi.unstubAllGlobals());

// ── §10.2 Close requires a write-up ──
describe("close requires a write-up", () => {
  const item = { id: "wi-1", kind: "alert", state: "owned", ticketKey: "OPS-9", ticketSystem: "jira", clientId: null, resolvedAt: null, metadata: {} };
  const good = { resolutionNote: "Vendor fixed the node; confirmed balance.", rootCause: "vendor_issue", riskScore: "Low" };

  it.each([
    [{ ...good, resolutionNote: "fixed" }, /at least 20 characters/],
    [{ ...good, rootCause: "gremlins" }, /Root cause must be one of/],
    [{ ...good, riskScore: "" }, /risk score is required/i],
  ])("returns 422 for an incomplete write-up (%#)", async (body, message) => {
    p.workItem.findUnique.mockResolvedValue(item);
    const res = await closeRoute(req("/api/work-items/wi-1/close", "POST", body), ctx("wi-1"));
    expect(res.status).toBe(422);
    const out = await res.json();
    expect(out.issues.join(" ")).toMatch(message);
    expect(calls).toHaveLength(0); // nothing sent to Jira
    expect(p.workItem.update).not.toHaveBeenCalled();
  });

  it("enforces the configured risk-score scale", async () => {
    p.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
      where.key === "workItem.riskScoreScale" ? { key: where.key, value: ["1", "2", "3"] } : null);
    p.workItem.findUnique.mockResolvedValue(item);
    const res = await closeRoute(req("/api/work-items/wi-1/close", "POST", { ...good, riskScore: "Low" }), ctx("wi-1"));
    expect(res.status).toBe(422);
    expect((await res.json()).issues).toContain("Risk score must be one of: 1, 2, 3.");
  });

  it("requires a time-log bucket to close a client request (spec §7.7)", async () => {
    p.workItem.findUnique.mockResolvedValue({ ...item, kind: "client_request" });
    let res = await closeRoute(req("/api/work-items/wi-1/close", "POST", good), ctx("wi-1"));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/time spent/i);

    res = await closeRoute(req("/api/work-items/wi-1/close", "POST", { ...good, timeLogBucketMins: 45 }), ctx("wi-1"));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/15, 30, 60, 120, 240/);
  });

  it("transitions the ticket first, then saves the write-up and time log", async () => {
    p.workItem.findUnique.mockResolvedValue({ ...item, kind: "client_request", ticketSystem: "jsm" });
    p.workItem.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...item, ...data }));
    stubJira((c) => (c.method === "GET"
      ? json({ transitions: [{ id: "5", name: "Close", to: { name: "Closed", statusCategory: { key: "done" } } }] })
      : new Response(null, { status: 204 })));

    const res = await closeRoute(req("/api/work-items/wi-1/close", "POST", { ...good, timeLogBucketMins: 30 }), ctx("wi-1"));
    expect(res.status).toBe(200);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /rest/api/3/issue/OPS-9/transitions", "POST /rest/api/3/issue/OPS-9/transitions"]);
    expect(p.workItem.update.mock.calls.at(-1)![0].data).toMatchObject({ rootCause: "vendor_issue", riskScore: "Low" });
    expect(p.timeLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ workItemId: "wi-1", bucketMins: 30, loggedById: "emp-1" }) });
  });
});

// ── §10.2 Acknowledge requires a ticket ──
describe("acknowledge requires a ticket", () => {
  it("returns 422 when the alert has no work item or its work item has no ticket", async () => {
    p.alert.findUnique.mockImplementation(async ({ select }: { select?: unknown }) =>
      select ? { workItem: null } : { id: "a1", status: "active", ruleCode: "ALR-X", workItemId: null });
    let res = await ackRoute(req("/api/alerts/a1/acknowledge", "POST"), ctx("a1"));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/cannot be acknowledged until it is linked to a work item with a Jira\/JSM ticket/);

    p.alert.findUnique.mockImplementation(async ({ select }: { select?: unknown }) =>
      select ? { workItem: { ticketKey: null } } : { id: "a1", status: "active", ruleCode: "ALR-X", workItemId: "wi-1" });
    res = await ackRoute(req("/api/alerts/a1/acknowledge", "POST"), ctx("a1"));
    expect(res.status).toBe(422);
    expect(p.alert.update).not.toHaveBeenCalled();
  });

  it("acknowledges when the ticket exists", async () => {
    p.alert.findUnique.mockImplementation(async ({ select }: { select?: unknown }) =>
      select ? { workItem: { ticketKey: "OPS-1" } } : { id: "a1", status: "active", ruleCode: "ALR-X", workItemId: "wi-1" });
    p.alert.update.mockResolvedValue({ id: "a1", status: "acknowledged" });
    const res = await ackRoute(req("/api/alerts/a1/acknowledge", "POST"), ctx("a1"));
    expect(res.status).toBe(200);
    expect(p.alert.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: expect.objectContaining({ status: "acknowledged" }) });
  });

  it("applies the same rule to the legacy comms alerts endpoint", async () => {
    authState.user = { ...authState.user, role: "lead" };
    p.alert.findUnique.mockResolvedValue({ workItem: null });
    const res = await commsAlertsPatch(req("/api/comms/alerts", "PATCH", { alertId: "a1", action: "acknowledge" }));
    expect(res.status).toBe(422);
    expect(p.alert.update).not.toHaveBeenCalled();
  });
});

// ── §10.2 No silent pass; skipping needs approval ──
describe("daily checks", () => {
  const now = Date.now();
  const pending = { id: "i1", runId: "r1", name: "Stuck transactions", category: "stuck_tx", status: "pending", definitionCode: "CHK-01", definition: { evidenceSpec: { freshnessMinutes: 60 }, ticketProject: "OPS", team: "Team 1" }, exceptionWorkItemIds: [], skipRequestedBy: null, skippedReason: null, completedAt: null };

  beforeEach(() => {
    p.dailyCheckItem.findUnique.mockResolvedValue(pending);
    p.dailyCheckItem.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...pending, ...data }));
    p.dailyCheckRun.findUnique.mockResolvedValue({ id: "r1", completedAt: null, items: [{ status: "pending" }] });
  });

  it("rejects a pass without evidence", async () => {
    const res = await dailyPatch(req("/api/daily-checks", "PATCH", { itemId: "i1", status: "pass" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/recordCount .* dataAsOf .* source/);
    expect(p.dailyCheckItem.update).not.toHaveBeenCalled();
  });

  it("rejects a pass whose data is older than the freshness limit", async () => {
    const evidence = { recordCount: 0, dataAsOf: new Date(now - 2 * 3_600_000).toISOString(), source: "custody API" };
    const res = await dailyPatch(req("/api/daily-checks", "PATCH", { itemId: "i1", status: "pass", evidence }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/stale.*60-minute limit/);
  });

  it("accepts a pass with fresh evidence (recordCount 0 allowed)", async () => {
    const evidence = { recordCount: 0, dataAsOf: new Date(now - 10 * 60_000).toISOString(), source: "custody API" };
    const res = await dailyPatch(req("/api/daily-checks", "PATCH", { itemId: "i1", status: "pass", evidence }));
    expect(res.status).toBe(200);
    expect(p.dailyCheckItem.update.mock.calls[0][0].data).toMatchObject({ status: "pass", recordCount: 0 });
  });

  it("refuses issues_found without structured exceptions", async () => {
    const res = await dailyPatch(req("/api/daily-checks", "PATCH", { itemId: "i1", status: "issues_found", notes: "some issues" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/exceptions.*each one gets a ticket/);
  });

  it("turns each exception row into a ticketed work item", async () => {
    p.jiraProjectConfig.findUnique.mockResolvedValue({ key: "OPS", enabled: true, kind: "jira", issueTypeIds: { Task: "10001", _default: "10001" } });
    let n = 0;
    p.workItem.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({ id: `wi-${++n}`, ticketKey: null, metadata: {}, ...create }));
    const ticketed = new Set<string>();
    p.workItem.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: { ticketKey?: string } }) => {
      if (data.ticketKey) ticketed.add(where.id);
      return { id: where.id };
    });
    p.workItem.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, ticketKey: ticketed.has(where.id) ? `OPS-${where.id}` : null, metadata: {} }));
    stubJira(() => json({ id: "1", key: "OPS-50" }, 201));

    const res = await exceptionsRoute(req("/api/daily-checks/items/i1/exceptions", "POST", { exceptions: [{ summary: "Withdrawal stuck 3h", reference: "tx-1" }, { summary: "Deposit not credited" }] }), ctx("i1"));
    expect(res.status).toBe(200);
    expect(calls.filter((c) => c.path === "/rest/api/3/issue")).toHaveLength(2);
    expect(p.workItem.upsert.mock.calls[0][0].create).toMatchObject({ kind: "daily_check_exception", team: "Team 1", taskCode: "CHK-01", sourceSystem: "daily_check", sourceId: "i1:1" });
    expect(p.dailyCheckItem.update.mock.calls.at(-1)![0].data).toMatchObject({ status: "issues_found", exceptionWorkItemIds: ["wi-1", "wi-2"] });
  });

  it("rejects exceptions without a summary", async () => {
    const res = await exceptionsRoute(req("/api/daily-checks/items/i1/exceptions", "POST", { exceptions: [{ summary: "" }] }), ctx("i1"));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/summary/);
  });

  it("keeps a skip pending until a different lead approves it", async () => {
    let res = await dailyPatch(req("/api/daily-checks", "PATCH", { itemId: "i1", status: "skipped" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/needs a reason/);

    res = await dailyPatch(req("/api/daily-checks", "PATCH", { itemId: "i1", status: "skipped", skippedReason: "Source system outage" }));
    expect(res.status).toBe(200);
    expect(p.dailyCheckItem.update.mock.calls.at(-1)![0].data).toEqual({ skippedReason: "Source system outage", skipRequestedBy: "u1", skipApprovedBy: null });
    expect((await res.json()).data.status).toBe("pending");

    const requested = { ...pending, skipRequestedBy: "u1", skippedReason: "Source system outage" };
    p.dailyCheckItem.findUnique.mockResolvedValue(requested);
    // An employee cannot approve.
    res = await approveSkipRoute(req("/api/daily-checks/items/i1/skip-signoff", "POST"), ctx("i1"));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/lead or admin/);
    // The requester cannot approve their own skip, even as a lead.
    authState.user = { ...authState.user, role: "lead" };
    res = await approveSkipRoute(req("/api/daily-checks/items/i1/skip-signoff", "POST"), ctx("i1"));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/different person/);
    // A different lead can.
    authState.user = { ...authState.user, id: "u2", employeeId: "emp-2" };
    res = await approveSkipRoute(req("/api/daily-checks/items/i1/skip-signoff", "POST"), ctx("i1"));
    expect(res.status).toBe(200);
    expect(p.dailyCheckItem.update.mock.calls.at(-1)![0].data).toMatchObject({ status: "skipped", skipApprovedBy: "u2" });
  });
});

// ── §10.1 Every alert that fires raises a ticket ──
describe("alert tickets", () => {
  const alert = { id: "a1", ruleCode: "ALR-OES-01", dedupeKey: "s-1", message: "Settlement failed", severity: "critical", priority: "P1", firstFiredAt: new Date("2026-09-23T08:00:00Z"), lastFiredAt: new Date("2026-09-23T09:00:00Z"), fireCount: 2, workItem: null as Record<string, unknown> | null };

  it("creates the work item and ticket on first firing and links the alert", async () => {
    p.alert.findUnique.mockResolvedValue(alert);
    p.alertRule.findUnique.mockResolvedValue({ route: { businessHours: [], outOfHours: [], ticketProject: "OPS" } });
    p.jiraProjectConfig.findUnique.mockResolvedValue({ key: "OPS", enabled: true, kind: "jira", issueTypeIds: { _default: "10001" } });
    p.workItem.upsert.mockResolvedValue({ id: "wi-9", ticketKey: null, metadata: {} });
    p.workItem.findUnique.mockResolvedValue({ id: "wi-9", ticketKey: null, metadata: {} });
    stubJira(() => json({ id: "1", key: "OPS-77" }, 201));

    await ensureAlertTicket("a1", { repeat: false });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/rest/api/3/issue" });
    expect((calls[0].body as { fields: { project: { key: string } } }).fields.project.key).toBe("OPS");
    expect(p.workItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ticketKey: "OPS-77", ticketSystem: "jira" }) }));
    expect(p.alert.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { workItemId: "wi-9" } });
  });

  it("comments on the same ticket when the alert fires again", async () => {
    p.alert.findUnique.mockResolvedValue({ ...alert, workItem: { id: "wi-9", ticketKey: "OPS-77" } });
    p.workItem.findUnique.mockResolvedValue({ id: "wi-9", ticketKey: "OPS-77", ticketSystem: "jira" });
    stubJira(() => json({ id: "c1" }, 201));
    await ensureAlertTicket("a1", { repeat: true });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /rest/api/3/issue/OPS-77/comment"]);
  });

  it("records the write-back error when the project is not enabled (reported next morning)", async () => {
    p.alert.findUnique.mockResolvedValue(alert);
    p.alertRule.findUnique.mockResolvedValue({ route: { ticketProject: "OPS" } });
    p.jiraProjectConfig.findUnique.mockResolvedValue({ key: "OPS", enabled: false, kind: "jira", issueTypeIds: {} });
    p.workItem.upsert.mockResolvedValue({ id: "wi-9", ticketKey: null, metadata: {} });
    p.workItem.findUnique.mockResolvedValue({ id: "wi-9", ticketKey: null, metadata: {} });
    await ensureAlertTicket("a1", { repeat: false });
    expect(calls).toHaveLength(0);
    expect(p.workItem.update.mock.calls[0][0].data.metadata.writebackError.message).toMatch(/OPS is not enabled/);
  });
});

// ── §10.3 Unticketed report on fixtures ──
describe("unticketed work report", () => {
  const now = new Date("2026-09-23T07:30:00Z"); // 08:30 London (BST)

  function seedFixtures() {
    p.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
      where.key === "intake.slack.route" ? { key: where.key, value: "kommand" } : null);
    p.commsThread.findMany.mockResolvedValue([
      { id: "t-covered", source: "slack", subject: "Where is my withdrawal?", createdAt: now, messages: [{ authorType: "external", timestamp: new Date("2026-09-22T10:00:00Z") }] },
      { id: "t-missed", source: "slack", subject: "Please confirm settlement", createdAt: now, messages: [{ authorType: "external", timestamp: new Date("2026-09-22T11:00:00Z") }] },
      { id: "t-staff", source: "slack", subject: "FYI", createdAt: now, messages: [{ authorType: "internal", timestamp: new Date("2026-09-22T12:00:00Z") }] },
    ]);
    p.workItem.findMany.mockImplementation(async (args?: unknown) =>
      (args as { where: { kind?: string } }).where.kind === "client_request"
        ? [{ metadata: { threadId: "t-covered" } }]
        : [{ id: "wi-5", title: "[ALR-OES-01] Settlement failed", metadata: { writebackError: { message: "Ticket project OPS is not enabled." } } }]);
    p.sourceRecord.findMany.mockResolvedValue([]);
    p.alert.findMany.mockResolvedValue([{ id: "a1", ruleCode: "ALR-OES-01", message: "Settlement failed", workItemId: "wi-5" }]);
    p.dailyCheckItem.findMany.mockResolvedValue([{ id: "i9", name: "Stuck transactions", definitionCode: "CHK-01" }]);
  }

  it("lists each kind of unticketed work", async () => {
    seedFixtures();
    const r = await buildUnticketedReport(now);
    expect(r.clientMessagesWithoutRequest).toEqual([{ threadId: "t-missed", source: "slack", subject: "Please confirm settlement", at: "2026-09-22T11:00:00.000Z" }]);
    expect(r.alertsWithoutTicket).toEqual([{ alertId: "a1", ruleCode: "ALR-OES-01", message: "Settlement failed", workItemId: "wi-5" }]);
    expect(r.checksWithoutExceptions).toEqual([{ itemId: "i9", name: "Stuck transactions", definitionCode: "CHK-01" }]);
    expect(r.writebackFailures).toEqual([{ workItemId: "wi-5", title: "[ALR-OES-01] Settlement failed", error: "Ticket project OPS is not enabled." }]);
    expect(r.total).toBe(4);
  });

  it("stores the report for the Morning Board and raises ALR-TKT-01 when non-empty", async () => {
    seedFixtures();
    p.alertRule.findUnique.mockResolvedValue({ code: "ALR-TKT-01", enabled: true, severity: "high", route: {} });
    p.alert.findFirst.mockResolvedValue(null);
    p.alert.create.mockResolvedValue({ id: "a-tkt" });
    p.alert.findUnique.mockResolvedValue(null);

    const out = await runUnticketedReport(now);
    expect(out).toMatchObject({ date: "2026-09-23", total: 4, posted: false });
    expect(p.sourceRecord.upsert.mock.calls[0][0].where).toEqual({ source_kind_externalId: { source: "kommand", kind: "unticketed_report", externalId: "2026-09-23" } });
    expect(p.alert.create.mock.calls[0][0].data).toMatchObject({ ruleCode: "ALR-TKT-01", dedupeKey: "2026-09-23" });
  });

  it("does not raise ALR-TKT-01 for an empty report", async () => {
    p.commsThread.findMany.mockResolvedValue([]);
    const out = await runUnticketedReport(now);
    expect(out.total).toBe(0);
    expect(p.alert.create).not.toHaveBeenCalled();
  });
});

describe("reconciliation", () => {
  it("raises ALR-TKT-02 on divergence between work items and open tickets", async () => {
    p.jiraProjectConfig.findMany.mockResolvedValue([{ key: "OPS", syncInbound: true }]);
    p.workItem.findMany
      .mockResolvedValueOnce([{ ticketKey: "OPS-1" }, { ticketKey: "OPS-2" }]) // open locally
      .mockResolvedValueOnce([]); // OPS-3 not known locally
    stubJira(() => json({ issues: [{ key: "OPS-1", fields: {} }, { key: "OPS-3", fields: {} }], isLast: true }));
    p.alertRule.findUnique.mockResolvedValue({ code: "ALR-TKT-02", enabled: true, severity: "medium", route: {} });
    p.alert.findFirst.mockResolvedValue(null);
    p.alert.create.mockResolvedValue({ id: "a2" });
    p.alert.findUnique.mockResolvedValue(null);

    const out = await reconcileTickets();
    expect(out).toEqual({ closedRemotely: 1, reopenedRemotely: 0, missingLocally: 1 });
    expect(p.alert.create.mock.calls[0][0].data.message).toMatch(/OPS-2, OPS-3/);
  });
});

describe("INC drafts (§10.4)", () => {
  it("does nothing while incident_log.drafts.enabled is off", async () => {
    expect(await createIncidentLogDraft("wi-1", "ALR-RSK-06")).toBeNull();
    expect(p.incidentLogDraft.create).not.toHaveBeenCalled();
  });

  it("creates a pre-filled INC issue due in 24 hours when on", async () => {
    flags.incidentLog = true;
    p.incidentLogDraft.findFirst.mockResolvedValue(null);
    p.workItem.findUnique.mockResolvedValue({ id: "wi-1", title: "KYT hit after broadcast", ticketKey: "OPS-4", priority: "P1", clockStartedAt: new Date("2026-09-23T08:00:00Z"), exposureUsd: null });
    p.jiraProjectConfig.findUnique.mockResolvedValue({ key: "INC", enabled: true, issueTypeIds: { _default: "3" } });
    p.incidentLogDraft.create.mockImplementation(async ({ data }: { data: unknown }) => data);
    stubJira(() => json({ id: "1", key: "INC-12" }, 201));
    const now = new Date("2026-09-23T09:00:00Z");
    const draft = await createIncidentLogDraft("wi-1", "ALR-RSK-06", now);
    expect(draft).toMatchObject({ workItemId: "wi-1", triggerCode: "ALR-RSK-06", jiraKey: "INC-12", dueAt: new Date("2026-09-24T09:00:00Z") });
    expect((calls[0].body as { fields: { summary: string } }).fields.summary).toBe("[DRAFT] KYT hit after broadcast");
  });
});

describe("report schedule", () => {
  it("runs at 08:30 Europe/London across daylight saving", () => {
    expect(getNextCronRun("TZ=Europe/London 30 8 * * *", new Date("2026-09-23T06:00:00Z")).toISOString()).toBe("2026-09-23T07:30:00.000Z");
    expect(getNextCronRun("TZ=Europe/London 30 8 * * *", new Date("2026-12-01T06:00:00Z")).toISOString()).toBe("2026-12-01T08:30:00.000Z");
    expect(getNextCronRun("15 * * * *", new Date("2026-09-23T06:00:00Z")).toISOString()).toBe("2026-09-23T06:15:00.000Z");
  });
});
