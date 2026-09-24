/**
 * Spec §12 Team 2: MTD breaks (type, T+1 SLA, daily TOPS ticket auto-close),
 * scam/dust closure rules and the Tech false-positive ticket, OTC assignment
 * notifications, and the TOKENS two-way sync with AI research disabled.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof import("@/__tests__/helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", async () => {
  const { createFakePrisma } = await import("@/__tests__/helpers/fake-prisma");
  db.client = createFakePrisma();
  return { prisma: db.client };
});
const envVars = vi.hoisted(() => ({ ATLASSIAN_BASE_URL: "https://komainu.atlassian.net", ATLASSIAN_EMAIL: "svc@example.com", ATLASSIAN_API_TOKEN: "t" } as Record<string, string | undefined>));
vi.mock("@/lib/env", () => ({ env: (k: string) => envVars[k] }));
vi.mock("@/lib/http/allowed-hosts", () => ({ getAllowedHosts: () => new Set(["komainu.atlassian.net"]) }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: vi.fn(async () => false) }));
const slack = vi.hoisted(() => ({ posts: [] as Array<{ channel: string; text: string }> }));
vi.mock("@/lib/integrations/slack", () => ({
  getSlackClient: () => ({
    chat: { postMessage: async (m: { channel: string; text: string }) => { slack.posts.push(m); return { ok: true }; } },
    users: { lookupByEmail: async ({ email }: { email: string }) => ({ user: email === "head@k.com" ? { id: "U-HEAD" } : undefined }) },
  }),
}));
const auth = vi.hoisted(() => ({ user: { id: "u1", name: "Op", email: "op@k.com", role: "lead", employeeId: "emp-1", team: null } as Record<string, unknown> }));
vi.mock("@/lib/auth-user", () => ({ requireAuth: vi.fn(async () => auth.user) }));
vi.mock("@/lib/api/rate-limit-middleware", () => ({ checkRateLimit: () => null, RATE_LIMIT_PRESETS: { mutation: {} } }));

import { CircuitBreaker } from "@/lib/circuit-breaker";
import { recordExceptions } from "@/modules/daily-checks/enforcement";
import { syncDailyCheckDefinitions } from "@/modules/daily-checks/schedule";
import { autoCloseDailyMtdTickets } from "@/modules/daily-checks/mtd";
import { closureIssues } from "@/modules/work-items/closure-rules";
import { POST as scamDust } from "@/app/api/work-items/[id]/scam-dust/route";
import { applyIssue } from "@/modules/integrations/atlassian/sync";
import { GET as otcGet } from "@/app/api/otc/route";
import { PUT as prefsPut } from "@/app/api/notifications/preferences/route";
import { POST as tokensPost, GET as tokensGet } from "@/app/api/tokens/route";

const p = () => db.client;
const add = (m: string, data: Record<string, unknown>) => p()[m].create({ data });
const req = (url: string, method: string, body?: unknown) => new NextRequest(`http://localhost${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jira = { calls: [] as Array<{ method: string; path: string; body: unknown }>, n: 0 };
const writeUp = { resolutionNote: "Explained: exchange-side reporting delay.", rootCause: "data_issue", riskScore: "Low" };

beforeEach(async () => {
  p().__reset();
  CircuitBreaker.resetAll();
  slack.posts.length = 0;
  auth.user = { id: "u1", name: "Op", email: "op@k.com", role: "lead", employeeId: "emp-1", team: null };
  jira.calls = [];
  jira.n = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(input.toString());
    const call = { method: init?.method ?? "GET", path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null };
    jira.calls.push(call);
    if (call.method === "POST" && call.path === "/rest/api/3/issue") return new Response(JSON.stringify({ id: "1", key: `${(call.body as { fields: { project: { key: string } } }).fields.project.key}-${++jira.n}` }), { status: 201 });
    if (call.method === "GET" && call.path.endsWith("/transitions")) return new Response(JSON.stringify({ transitions: [{ id: "9", name: "Done", to: { statusCategory: { key: "done" } } }] }), { status: 200 });
    return new Response(JSON.stringify({ id: "c" }), { status: 201 });
  }));
  for (const key of ["OTC", "TOPS", "TOKENS", "GXS"]) await add("jiraProjectConfig", { key, name: key, kind: "jira", enabled: true, issueTypeIds: { _default: "1" } });
  await add("slaPolicy", { id: "sla-mtd", code: "MTD-BREAK", description: "", resolveRule: "next_business_day_eod", calendar: "business_uk", warnAtPct: 50, isActive: true });
  await syncDailyCheckDefinitions();
});
afterEach(() => vi.unstubAllGlobals());

async function mtdItem() {
  return add("dailyCheckItem", { id: "i-mtd", runId: "r", name: "Daily MTD Variances (client assets)", category: "CHK-02", definitionCode: "CHK-02", periodKey: "2026-09-23" });
}

describe("CHK-02 MTD breaks", () => {
  it("records each break as an mtd_break in OTC with the T+1 SLA and opens the daily TOPS MTD ticket", async () => {
    await mtdItem();
    const r = await recordExceptions("i-mtd", [{ summary: "BTC variance on client wallet", reference: "w-1" }], "emp-1");
    const brk = await p().workItem.findUnique({ where: { id: r.workItemIds[0] } });
    expect(brk).toMatchObject({ kind: "mtd_break", ticketKey: "OTC-1", slaPolicyId: "sla-mtd", team: "Team 2" });
    expect(brk!.metadata).toMatchObject({ breakType: "unclassified", gxStatusVsChain: "unverified" });
    const created = jira.calls.filter((c) => c.path === "/rest/api/3/issue");
    expect(JSON.stringify(created[0].body)).toContain("GX status vs chain unverified");
    expect(created.map((c) => (c.body as { fields: { project: { key: string } } }).fields.project.key)).toEqual(["OTC", "TOPS"]);
  });

  it("requires a listed break type once the list exists", async () => {
    await mtdItem();
    await add("otcBreakType", { code: "missing_tx", label: "Missing transaction", isActive: true, sortOrder: 0 });
    await expect(recordExceptions("i-mtd", [{ summary: "BTC variance on client wallet" }], "emp-1")).rejects.toThrow(/break type from the list \(missing_tx\)/);
    const ok = await recordExceptions("i-mtd", [{ summary: "BTC variance on client wallet", breakType: "missing_tx" }], "emp-1");
    expect((await p().workItem.findUnique({ where: { id: ok.workItemIds[0] } }))!.metadata).toMatchObject({ breakType: "missing_tx" });
  });

  it("closes the daily TOPS MTD ticket (comment + transition) once every break is resolved or explained", async () => {
    await mtdItem();
    await add("appSetting", { key: "mtd.autoCloseRiskScore", value: "Low" });
    const r = await recordExceptions("i-mtd", [{ summary: "BTC variance one" }, { summary: "ETH variance two" }], "emp-1");
    const daily = await p().workItem.findFirst({ where: { sourceSystem: "daily_check_report" } });
    expect(daily!.ticketKey).toBe("TOPS-3");

    await p().workItem.update({ where: { id: r.workItemIds[0] }, data: { state: "closed" } });
    expect(await autoCloseDailyMtdTickets()).toEqual({ closed: 0, readyForLead: 0 });

    await p().workItem.update({ where: { id: r.workItemIds[1] }, data: { state: "resolved" } });
    expect(await autoCloseDailyMtdTickets()).toEqual({ closed: 1, readyForLead: 0 });
    expect(jira.calls.some((c) => c.path === "/rest/api/3/issue/TOPS-3/comment")).toBe(true);
    expect(jira.calls.at(-1)).toMatchObject({ method: "POST", path: "/rest/api/3/issue/TOPS-3/transitions" });
    expect((await p().workItem.findUnique({ where: { id: daily!.id } }))).toMatchObject({ state: "closed", rootCause: "no_action_required" });
  });

  it("only comments (for the lead to close) while no auto-close risk score is configured", async () => {
    await mtdItem();
    const r = await recordExceptions("i-mtd", [{ summary: "BTC variance one" }], "emp-1");
    await p().workItem.update({ where: { id: r.workItemIds[0] }, data: { state: "closed" } });
    expect(await autoCloseDailyMtdTickets()).toEqual({ closed: 0, readyForLead: 1 });
    expect(await autoCloseDailyMtdTickets()).toEqual({ closed: 0, readyForLead: 1 });
    expect(jira.calls.filter((c) => c.path.endsWith("/comment"))).toHaveLength(1); // commented once
  });
});

describe("CHK-06 scam and dust", () => {
  beforeEach(async () => {
    await add("workItem", { id: "wi-sd", kind: "scam_dust_case", title: "Dust from 0xabc", taskCode: "CHK-06", sourceSystem: "daily_check", sourceId: "x", ticketKey: "TOPS-7", clockStartedAt: new Date() });
  });

  it("requires the client advisory, and the client decision when the client overrides (CF-35)", async () => {
    let item = await p().workItem.findUnique({ where: { id: "wi-sd" } });
    expect(await closureIssues(item as never, { writeUp })).toContain("Record the client advisory before closing.");
    await scamDust(req("/x", "POST", { clientAdvisory: "Client advised not to interact.", clientOverride: true }), ctx("wi-sd"));
    item = await p().workItem.findUnique({ where: { id: "wi-sd" } });
    expect(await closureIssues(item as never, { writeUp })).toEqual(["The client overrode Komainu's scam assessment: attach the client decision before closing (CF-35)."]);
    await scamDust(req("/x", "POST", { clientDecisionUrl: "https://komainu.atlassian.net/wiki/decision-1" }), ctx("wi-sd"));
    item = await p().workItem.findUnique({ where: { id: "wi-sd" } });
    expect(await closureIssues(item as never, { writeUp })).toEqual([]);
  });

  it("flags a possible false positive with a ticket to Tech (CF-34), once", async () => {
    await add("appSetting", { key: "scamDust.techProject", value: "GXS" });
    await scamDust(req("/x", "POST", { possibleFalsePositive: true }), ctx("wi-sd"));
    await scamDust(req("/x", "POST", { possibleFalsePositive: true }), ctx("wi-sd"));
    const fp = await p().workItem.findMany({ where: { sourceSystem: "scam_dust_fp" } });
    expect(fp).toHaveLength(1);
    expect(fp[0].ticketKey).toBe("GXS-1");
  });

  it("refuses these fields on other kinds", async () => {
    await add("workItem", { id: "wi-x", kind: "alert", title: "x", taskCode: "x", sourceSystem: "s", sourceId: "y", clockStartedAt: new Date() });
    expect((await scamDust(req("/x", "POST", { clientAdvisory: "abc" }), ctx("wi-x"))).status).toBe(422);
  });
});

describe("TASK-OTC", () => {
  const issue = (assigneeEmail: string | null) => ({
    key: "OTC-42",
    fields: { summary: "Void transaction request", status: { name: "In Progress", statusCategory: { key: "indeterminate" } }, assignee: assigneeEmail ? { accountId: "a", emailAddress: assigneeEmail } : null, updated: new Date().toISOString(), created: new Date().toISOString(), project: { key: "OTC" } },
  });
  const cfg = { kind: "jira", defaultWorkItemKind: "internal_task", defaultTeam: "Team 2", defaultTaskCode: "TASK-OTC" };

  beforeEach(async () => {
    await add("employee", { id: "emp-head", name: "Head of TO", email: "head@k.com", role: "Manager", team: "TransactionOperations", active: true });
    await add("user", { id: "u-head", email: "head@k.com", name: "Head", role: "admin", employeeId: "emp-head" });
  });

  it("DMs and notifies in-app when an OTC ticket is assigned to a user who opted in", async () => {
    auth.user = { id: "u-head", name: "Head", email: "head@k.com", role: "admin", employeeId: "emp-head", team: null };
    await prefsPut(req("/api/notifications/preferences", "PUT", { onAssignProjects: ["OTC"] }));
    await applyIssue(issue(null) as never, cfg);
    expect(slack.posts).toHaveLength(0);
    await applyIssue({ ...issue("head@k.com"), fields: { ...issue("head@k.com").fields, updated: new Date(Date.now() + 1000).toISOString() } } as never, cfg);
    expect(slack.posts).toEqual([{ channel: "U-HEAD", text: expect.stringContaining("OTC-42 was assigned to you") }]);
    expect(await p().inAppNotification.count({ where: { userId: "u-head" } })).toBe(1);
  });

  it("does not notify users who have not opted in to the project", async () => {
    await applyIssue(issue("head@k.com") as never, cfg);
    expect(slack.posts).toHaveLength(0);
    expect(await p().inAppNotification.count()).toBe(0);
  });

  it("filters the OTC queue by unassigned and overdue", async () => {
    await add("workItem", { kind: "internal_task", title: "old", taskCode: "TASK-OTC", sourceSystem: "jira", sourceId: "OTC-1", ticketKey: "OTC-1", clockStartedAt: new Date(Date.now() - 10 * 86_400_000) });
    await add("workItem", { kind: "internal_task", title: "new, owned", taskCode: "TASK-OTC", sourceSystem: "jira", sourceId: "OTC-2", ticketKey: "OTC-2", ownerEmployeeId: "emp-head", clockStartedAt: new Date() });
    const titles = async (f: string) => ((await (await otcGet(req(`/api/otc?filter=${f}`, "GET"))).json()).data.items as Array<{ title: string }>).map((i) => i.title);
    expect(await titles("all")).toEqual(["old", "new, owned"]);
    expect(await titles("unassigned")).toEqual(["old"]);
    expect(await titles("overdue")).toEqual(["old"]);
  });
});

describe("CHK-13 coin reviews and TOKENS", () => {
  it("opens a TOKENS ticket for a new review and writes status changes to it first", async () => {
    const res = await tokensPost(req("/api/tokens", "POST", { action: "create", symbol: "abc", name: "Alphabet Coin" }));
    const { data } = await res.json();
    expect(data.jiraTicket).toBe("TOKENS-1");
    await tokensPost(req("/api/tokens", "POST", { action: "update_status", tokenId: data.id, newStatus: "under_review" }));
    expect(jira.calls.at(-1)).toMatchObject({ method: "POST", path: "/rest/api/3/issue/TOKENS-1/comment" });
    expect((await p().tokenReview.findUnique({ where: { id: data.id } }))!.status).toBe("under_review");

    const list = (await (await tokensGet(req("/api/tokens", "GET"))).json()).data;
    expect(list.tokens[0]).toMatchObject({ jiraTicket: "TOKENS-1", jiraState: "open" });
  });

  it("changes nothing locally when Jira refuses the write", async () => {
    const { data } = await (await tokensPost(req("/api/tokens", "POST", { action: "create", symbol: "abc", name: "Alphabet Coin" }))).json();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 400 })));
    const res = await tokensPost(req("/api/tokens", "POST", { action: "update_status", tokenId: data.id, newStatus: "approved" }));
    expect(res.status).toBe(409);
    expect((await p().tokenReview.findUnique({ where: { id: data.id } }))!.status).toBe("proposed");
  });

  it("lists TOKENS tickets that have no review record", async () => {
    await add("workItem", { kind: "coin_review", title: "Review XYZ", taskCode: "JIRA-TOKENS", sourceSystem: "jira", sourceId: "TOKENS-99", ticketKey: "TOKENS-99", clockStartedAt: new Date() });
    const list = (await (await tokensGet(req("/api/tokens", "GET"))).json()).data;
    expect(list.jiraOnly.map((i: { ticketKey: string }) => i.ticketKey)).toEqual(["TOKENS-99"]);
  });

  it("refuses AI research while ai.enabled is off (H3)", async () => {
    const res = await tokensPost(req("/api/tokens", "POST", { action: "save_research", tokenId: "t", researchResult: {} }));
    expect(res.status).toBe(404);
  });
});
