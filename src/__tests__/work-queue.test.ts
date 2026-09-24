/**
 * Phase 9 (spec §14.1, §14.2, §14.4): the work queue, the work item detail
 * timeline and the work item actions (write-first to the ticket, audit, SSE).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof import("@/__tests__/helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", async () => {
  const { createFakePrisma } = await import("@/__tests__/helpers/fake-prisma");
  db.client = createFakePrisma();
  return { prisma: db.client };
});
const envVars = vi.hoisted(() => ({ ATLASSIAN_BASE_URL: "https://example.atlassian.net", ATLASSIAN_EMAIL: "svc@example.com", ATLASSIAN_API_TOKEN: "t" } as Record<string, string | undefined>));
vi.mock("@/lib/env", () => ({ env: (k: string) => envVars[k] }));
vi.mock("@/lib/http/allowed-hosts", () => ({ getAllowedHosts: () => new Set(["example.atlassian.net"]) }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: vi.fn(async () => false) }));
const sse = vi.hoisted(() => ({ events: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/sse", () => ({ emitWorkItemUpdate: (d: Record<string, unknown>) => sse.events.push(d) }));
const auth = vi.hoisted(() => ({ user: { id: "u-ann", name: "Ann", email: "ann@k.com", role: "employee", employeeId: "emp-ann", team: null } as Record<string, unknown> }));
vi.mock("@/lib/auth-user", () => ({ requireAuth: vi.fn(async () => auth.user) }));
vi.mock("@/lib/api/rate-limit-middleware", () => ({ checkRateLimit: () => null, RATE_LIMIT_PRESETS: { mutation: {}, read: {} } }));

import { GET as queueGet } from "@/app/api/work-items/route";
import { GET as detailGet } from "@/app/api/work-items/[id]/route";
import { POST as ownership } from "@/app/api/work-items/[id]/ownership/route";
import { POST as stateRoute } from "@/app/api/work-items/[id]/state/route";
import { POST as notes } from "@/app/api/work-items/[id]/notes/route";
import { POST as timeRoute } from "@/app/api/work-items/[id]/time/route";
import { POST as links } from "@/app/api/work-items/[id]/links/route";
import { GET as alertsGet } from "@/app/api/alerts/route";
import { slaStatus, type QueueRow } from "@/modules/work-items/queue";
import type { BusinessCalendar } from "@/modules/alerting/calendar";
import type { SlaPolicy, WorkItem } from "@prisma/client";

const p = () => db.client;
const add = (m: string, data: Record<string, unknown>) => p()[m].create({ data });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows from the in-memory store
const item = async (id: string): Promise<any> => p().workItem.findUnique({ where: { id } });
const req = (url: string, method = "GET", body?: unknown) => new NextRequest(`http://localhost${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

type Call = { method: string; path: string; body: Record<string, unknown> | null };
const jira = { calls: [] as Call[], fail: false, missing: new Set<string>() };

function stubAtlassian() {
  vi.stubGlobal("fetch", vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(input.toString());
    const c: Call = { method: init?.method ?? "GET", path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null };
    jira.calls.push(c);
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
    if (jira.fail && c.method !== "GET") return json({ errorMessages: ["down"] }, 500);
    if (c.path === "/rest/api/3/user/search") {
      const email = url.searchParams.get("query") ?? "";
      return json([{ accountId: `acc-${email.split("@")[0]}`, emailAddress: email, active: true }]);
    }
    if (c.method === "GET" && c.path.endsWith("/transitions")) return json({ transitions: [{ id: "21", name: "Waiting for customer", to: { statusCategory: { key: "indeterminate" } } }] });
    if (c.method === "GET" && /\/rest\/api\/3\/issue\/[A-Z]+-\d+\/comment$/.test(c.path)) {
      return json({ comments: [{ id: "1", created: "2026-09-23T09:30:00.000Z", author: { displayName: "Jira Bot" }, body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Checked the ledger" }] }] } }] });
    }
    if (c.method === "GET" && /\/rest\/api\/3\/issue\/[A-Z]+-\d+$/.test(c.path)) {
      const key = c.path.split("/").pop()!;
      return jira.missing.has(key) ? json({ errorMessages: ["not found"] }, 404) : json({ id: "1", key, fields: { summary: "x" } });
    }
    if (c.method === "POST" && c.path.endsWith("/comment")) return json({ id: "c1" }, 201);
    return new Response(null, { status: 204 });
  }));
}

const NOW = new Date("2026-09-23T10:00:00Z"); // Wednesday 11:00 London
const ago = (mins: number) => new Date(NOW.getTime() - mins * 60_000);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  p().__reset();
  jira.calls = [];
  jira.fail = false;
  jira.missing = new Set();
  sse.events = [];
  auth.user = { id: "u-ann", name: "Ann", email: "ann@k.com", role: "employee", employeeId: "emp-ann", team: null };
  stubAtlassian();

  await add("employee", { id: "emp-ann", name: "Ann Operator", email: "ann@k.com", role: "Analyst", team: "TransactionOperations", active: true });
  await add("employee", { id: "emp-bob", name: "Bob Operator", email: "bob@k.com", role: "Analyst", team: "TransactionOperations", active: true });
  await add("employee", { id: "emp-lee", name: "Lee Lead", email: "lee@k.com", role: "Lead", team: "TransactionOperations", active: true });
  await add("teamConfig", { team: "Team 2", leadEmployeeId: "emp-lee", memberEmployeeIds: ["emp-ann", "emp-bob"] });
  await add("client", { id: "cl-1", displayName: "Acme Capital", isActive: true });
  await add("slaPolicy", { id: "sla-q", code: "CLIENT-Q-P2", description: "", ownershipMins: 30, firstRespMins: 60, resolveMins: 480, calendar: "24x7", warnAtPct: 75, isActive: true });

  const base = { kind: "client_request", team: "Team 2", taskCode: "CLIENT-Q", sourceSystem: "slack", clientId: "cl-1", slaPolicyId: "sla-q", ticketSystem: "jira" };
  await add("workItem", { ...base, id: "wi-breach", title: "Breached request", sourceId: "C0123456:1695460000.000100", clockStartedAt: ago(40), ticketKey: "OPS-1", ticketUrl: "https://example.atlassian.net/browse/OPS-1" });
  await add("workItem", { ...base, id: "wi-warn", title: "Warning request", sourceId: "s2", clockStartedAt: ago(25), ticketKey: "OPS-2" });
  await add("workItem", { ...base, id: "wi-ok", title: "Fresh request", sourceId: "s3", clockStartedAt: ago(5), ticketKey: "OTC-3", ownerEmployeeId: "emp-ann", ownedAt: ago(4), state: "owned" });
  await add("workItem", { kind: "internal_task", team: "Team 2", taskCode: "T", sourceSystem: "kommand", sourceId: "s4", id: "wi-untimed", title: "Untimed task", clockStartedAt: ago(500) });
  await add("workItem", { ...base, id: "wi-team1", team: "Team 1", title: "Other team", sourceId: "s5", clockStartedAt: ago(5) });
  await add("workItem", { ...base, id: "wi-closed", title: "Closed one", sourceId: "s6", clockStartedAt: ago(5), state: "closed" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function queue(qs = ""): Promise<{ team: string | null; rows: QueueRow[] }> {
  const res = await queueGet(req(`/api/work-items${qs}`));
  expect(res.status).toBe(200);
  return (await res.json()).data;
}

describe("work queue (spec §14.1)", () => {
  it("defaults to my team (TeamConfig membership), open items only", async () => {
    const q = await queue();
    expect(q.team).toBe("Team 2");
    expect(q.rows.map((r) => r.id).sort()).toEqual(["wi-breach", "wi-ok", "wi-untimed", "wi-warn"]);
  });

  it("orders by SLA time remaining: breached first, untimed last, with a due time for the live timer", async () => {
    const q = await queue();
    expect(q.rows.map((r) => r.id)).toEqual(["wi-breach", "wi-warn", "wi-ok", "wi-untimed"]);
    const [breach, warn, ok, untimed] = q.rows;
    expect(breach.sla).toMatchObject({ state: "breach", clock: "ownership", dueAt: ago(10).toISOString() });
    expect(warn.sla).toMatchObject({ state: "warn", clock: "ownership" });
    expect(ok.sla).toMatchObject({ state: "ok", clock: "first_response" });
    expect(untimed.sla.state).toBe("none");
    expect(breach).toMatchObject({ client: { name: "Acme Capital" }, ticketKey: "OPS-1", owner: null });
    expect(ok.owner).toEqual({ id: "emp-ann", name: "Ann Operator" });
  });

  it("filters by team, kind, SLA state, ticket project and owner", async () => {
    expect((await queue("?team=all")).rows).toHaveLength(5);
    expect((await queue("?team=Team%201")).rows.map((r) => r.id)).toEqual(["wi-team1"]);
    expect((await queue("?kind=internal_task")).rows.map((r) => r.id)).toEqual(["wi-untimed"]);
    expect((await queue("?sla=breach")).rows.map((r) => r.id)).toEqual(["wi-breach"]);
    expect((await queue("?project=OTC")).rows.map((r) => r.id)).toEqual(["wi-ok"]);
    expect((await queue("?owner=me")).rows.map((r) => r.id)).toEqual(["wi-ok"]);
    expect((await queue("?owner=unassigned")).rows.map((r) => r.id)).not.toContain("wi-ok");
    expect((await queue("?status=closed&team=all")).rows.map((r) => r.id)).toEqual(["wi-closed"]);
  });

  it("falls back to all teams for a user in no team, and rejects bad filters", async () => {
    auth.user = { ...auth.user, employeeId: "emp-nobody" };
    expect((await queue()).team).toBeNull();
    expect((await queue()).rows).toHaveLength(5);
    expect((await queueGet(req("/api/work-items?priority=P9"))).status).toBe(400);
  });

  it("business-hours clocks pause out of hours and fall due on the next business day", () => {
    const cal: BusinessCalendar = { is24x7: false, startMin: 8 * 60, endMin: 18 * 60, holidays: new Set() };
    const item = { state: "open", ownedAt: null, firstResponseAt: null, resolvedAt: null, metadata: {}, clockStartedAt: new Date("2026-09-23T16:30:00Z") } as unknown as WorkItem;
    const policy = { ownershipMins: 60, firstRespMins: null, resolveMins: null, resolveRule: null, warnAtPct: 75 } as unknown as SlaPolicy;
    // 17:30 London start; at 20:00 London 30 business minutes are used, 30 remain from 08:00 next day.
    const s = slaStatus(item, policy, cal, new Date("2026-09-23T19:00:00Z"));
    expect(s).toMatchObject({ state: "ok", paused: true, elapsedMins: 30, dueAt: "2026-09-24T07:30:00.000Z" });
  });
});

describe("work item actions (spec §14.2)", () => {
  it("take ownership assigns in Jira first, then locally; audited and pushed over SSE", async () => {
    const res = await ownership(req("/x", "POST", { employeeId: "me" }), ctx("wi-warn"));
    expect(res.status).toBe(200);
    expect(jira.calls.some((c) => c.method === "PUT" && c.path === "/rest/api/3/issue/OPS-2/assignee")).toBe(true);
    expect(await item("wi-warn")).toMatchObject({ ownerEmployeeId: "emp-ann", state: "owned" });
    // Fail-closed audit: a requested entry before the change and a completed one after, linked by correlation id.
    const audit = await p().auditLog.findMany({ where: { action: "work_item_owner_changed", entityId: "wi-warn" } });
    expect(audit.map((a) => a.phase)).toEqual(["requested", "completed"]);
    expect(audit[0].correlationId).toBe(audit[1].correlationId);
    expect(sse.events).toContainEqual(expect.objectContaining({ workItemId: "wi-warn", change: "owner" }));
  });

  it("when the audit trail cannot be written, nothing happens: 503, no Jira call, no local change (fail-closed)", async () => {
    vi.spyOn(p().auditLog, "create").mockRejectedValueOnce(new Error("audit store unavailable"));
    const res = await ownership(req("/x", "POST", { employeeId: "me" }), ctx("wi-warn"));
    expect(res.status).toBe(503);
    expect(jira.calls.filter((c) => c.method !== "GET")).toEqual([]);
    expect((await item("wi-warn")).ownerEmployeeId ?? null).toBeNull();
  });

  it("when Jira rejects the change nothing changes locally (409)", async () => {
    jira.fail = true;
    const res = await ownership(req("/x", "POST", { employeeId: "me" }), ctx("wi-warn"));
    expect(res.status).toBe(409);
    expect((await item("wi-warn")).ownerEmployeeId ?? null).toBeNull();
  });

  it("only a lead, an admin or the current owner can reassign to someone else", async () => {
    expect((await ownership(req("/x", "POST", { employeeId: "emp-bob" }), ctx("wi-warn"))).status).toBe(403);
    expect((await ownership(req("/x", "POST", { employeeId: "emp-bob" }), ctx("wi-ok"))).status).toBe(200); // Ann owns wi-ok
    auth.user = { ...auth.user, id: "u-lee", role: "lead", employeeId: "emp-lee" };
    expect((await ownership(req("/x", "POST", { employeeId: "emp-bob" }), ctx("wi-warn"))).status).toBe(200);
    expect((await item("wi-warn")).ownerEmployeeId).toBe("emp-bob");
  });

  it("a waiting state needs a reason, which is kept as the blocker; the ticket moves first", async () => {
    expect((await stateRoute(req("/x", "POST", { state: "waiting_client" }), ctx("wi-ok"))).status).toBe(422);
    const res = await stateRoute(req("/x", "POST", { state: "waiting_client", reason: "Client to confirm the address" }), ctx("wi-ok"));
    expect(res.status).toBe(200);
    expect(jira.calls.some((c) => c.method === "POST" && c.path === "/rest/api/3/issue/OTC-3/transitions")).toBe(true);
    const row = await item("wi-ok");
    expect(row.state).toBe("waiting_client");
    expect(row.metadata.waitingReason).toBe("Client to confirm the address");
    // Resolve and close are not available here: they need the write-up.
    expect((await stateRoute(req("/x", "POST", { state: "closed" }), ctx("wi-ok"))).status).toBe(400);
  });

  it("an internal note is posted as an internal ticket comment", async () => {
    expect((await notes(req("/x", "POST", { text: "Chased the vendor by phone" }), ctx("wi-breach"))).status).toBe(200);
    expect(jira.calls.find((c) => c.method === "POST" && c.path === "/rest/api/3/issue/OPS-1/comment")).toBeTruthy();
    expect((await notes(req("/x", "POST", { text: "No ticket" }), ctx("wi-untimed"))).status).toBe(409);
  });

  it("time is logged in the fixed buckets only", async () => {
    expect((await timeRoute(req("/x", "POST", { bucketMins: 17 }), ctx("wi-breach"))).status).toBe(400);
    expect((await timeRoute(req("/x", "POST", { bucketMins: 30 }), ctx("wi-breach"))).status).toBe(200);
    expect(await p().timeLog.findMany({ where: { workItemId: "wi-breach" } })).toEqual([expect.objectContaining({ bucketMins: 30, clientId: "cl-1" })]);
  });

  it("a related ticket must exist in Jira, is linked there first, then recorded", async () => {
    jira.missing.add("OPS-404");
    expect((await links(req("/x", "POST", { key: "OPS-404" }), ctx("wi-breach"))).status).toBe(422);
    expect((await links(req("/x", "POST", { key: "ops-77" }), ctx("wi-breach"))).status).toBe(200);
    expect(jira.calls.some((c) => c.method === "POST" && c.path === "/rest/api/3/issueLink")).toBe(true);
    expect(await p().ticketLink.findMany({ where: { workItemId: "wi-breach" } })).toEqual([expect.objectContaining({ key: "OPS-77", role: "related" })]);
  });
});

describe("work item detail (spec §14.2)", () => {
  it("shows one timeline: source messages with raise links, ticket comments, alerts, SLA events and changes", async () => {
    await add("slackChannel", { id: "sc-1", channelId: "C0123456", name: "acme-ops", clientId: "cl-1" });
    await add("commsThread", { id: "th-1", source: "slack", sourceThreadRef: "C0123456:1695460000.000100", subject: "Withdrawal", slackChannelId: "sc-1", slackRootTs: "1695460000.000100" });
    await add("commsMessage", { threadId: "th-1", timestamp: ago(40), authorName: "Client Person", authorType: "external", bodySnippet: "Where is my withdrawal?", bodyLink: "https://custody.slack.com/archives/C0123456/p1695460000000100", slackTs: "1695460000.000100" });
    await add("alert", { type: "ALR-SLA-02", ruleCode: "ALR-SLA-02", dedupeKey: "wi-breach", message: "SLA ownership breach", severity: "high", workItemId: "wi-breach", firstFiredAt: ago(9) });
    await add("slaEvent", { workItemId: "wi-breach", kind: "ownership_breach", at: ago(9) });
    await notes(req("/x", "POST", { text: "Chased the vendor by phone" }), ctx("wi-breach"));

    const res = await detailGet(req("/api/work-items/wi-breach"), ctx("wi-breach"));
    expect(res.status).toBe(200);
    const d = (await res.json()).data;
    expect(d.item).toMatchObject({ title: "Breached request", client: { name: "Acme Capital" }, ticketKey: "OPS-1" });
    expect(d.sla.state).toBe("breach");
    const kinds = d.timeline.map((e: { kind: string }) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["message", "ticket_comment", "alert", "sla", "change"]));
    const msg = d.timeline.find((e: { kind: string }) => e.kind === "message");
    expect(msg).toMatchObject({ author: "Client Person", raiseLink: "/client-incidents/new?kind=slack&channelId=C0123456&ts=1695460000.000100" });
    expect(d.timeline.find((e: { kind: string }) => e.kind === "ticket_comment").text).toBe("Checked the ledger");
    expect(d.raiseLink).toBe("/client-incidents/new?kind=work_item&workItemId=wi-breach");
    expect(d.canPostClientUpdate).toBe(false);
    // Sorted oldest first.
    expect([...d.timeline].map((e: { at: string }) => e.at)).toEqual([...d.timeline].map((e: { at: string }) => e.at).sort());
  });

  it("still loads when Jira comments cannot be read, with a warning", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const d = (await (await detailGet(req("/x"), ctx("wi-breach"))).json()).data;
    expect(d.timelineWarning).toMatch(/could not be read/);
  });
});

describe("alerts page API (spec §14.1)", () => {
  it("lists engine alerts by severity with fire count, work item and ticket", async () => {
    await add("alert", { type: "ALR-SLA-01", ruleCode: "ALR-SLA-01", dedupeKey: "a", message: "SLA warning", severity: "medium", workItemId: "wi-warn", fireCount: 3 });
    await add("alert", { type: "ALR-OES-01", ruleCode: "ALR-OES-01", dedupeKey: "b", message: "OES late", severity: "critical", workItemId: "wi-breach" });
    await add("alert", { type: "tto_breach", ruleCode: "tto_breach", dedupeKey: "c", message: "legacy comms alert", severity: "high" });
    await add("alert", { type: "ALR-X", ruleCode: "ALR-X", dedupeKey: "d", message: "resolved one", severity: "high", status: "resolved" });
    const res = await alertsGet(req("/api/alerts"));
    expect(res.status).toBe(200);
    const { alerts } = (await res.json()).data;
    expect(alerts.map((a: { ruleCode: string }) => a.ruleCode)).toEqual(["ALR-OES-01", "ALR-SLA-01"]);
    expect(alerts[1]).toMatchObject({ fireCount: 3, workItem: { id: "wi-warn", ticketKey: "OPS-2" } });
    expect((await alertsGet(req("/api/alerts?status=bogus"))).status).toBe(400);
  });
});
