/**
 * Spec v2 §9.7 acceptance tests and H12:
 * client-ticket-scoped-to-one-client, no-auto-public-comments,
 * compliance-sensitive-blocks-client-ticket.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof import("@/__tests__/helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", async () => {
  const { createFakePrisma } = await import("@/__tests__/helpers/fake-prisma");
  db.client = createFakePrisma();
  return { prisma: db.client };
});
const envVars = vi.hoisted(() => ({ ATLASSIAN_BASE_URL: "https://example.atlassian.net", ATLASSIAN_EMAIL: "svc@example.com", ATLASSIAN_API_TOKEN: "t", NEXTAUTH_URL: "https://k.example", GRAPH_MAILBOXES: JSON.stringify([{ label: "custody", address: "custody@example.com", purpose: "custody" }]) } as Record<string, string | undefined>));
vi.mock("@/lib/env", () => ({ env: (k: string) => envVars[k] }));
vi.mock("@/lib/http/allowed-hosts", () => ({ getAllowedHosts: () => new Set(["example.atlassian.net"]) }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: vi.fn(async () => false) }));
const slack = vi.hoisted(() => ({ posts: [] as Array<{ channel: string; thread_ts?: string; text: string }> }));
vi.mock("@/lib/integrations/slack", () => ({
  getSlackClient: () => ({
    chat: {
      postMessage: async (m: { channel: string; thread_ts?: string; text: string }) => { slack.posts.push(m); return { ok: true }; },
      getPermalink: async ({ channel, message_ts }: { channel: string; message_ts: string }) => ({ permalink: `https://custody.slack.com/archives/${channel}/p${message_ts.replace(".", "")}` }),
    },
    users: { lookupByEmail: async () => ({}) },
  }),
}));
const auth = vi.hoisted(() => ({ user: { id: "u1", name: "Op", email: "op@k.com", role: "employee", employeeId: "emp-1", team: null } as Record<string, unknown> }));
vi.mock("@/lib/auth-user", () => ({ requireAuth: vi.fn(async () => auth.user) }));
vi.mock("@/lib/api/rate-limit-middleware", () => ({ checkRateLimit: () => null, RATE_LIMIT_PRESETS: { mutation: {}, read: {} } }));

import { CircuitBreaker } from "@/lib/circuit-breaker";
import { POST as raise } from "@/app/api/client-incidents/route";
import { GET as contextGet } from "@/app/api/client-incidents/context/route";
import { POST as clientTicket } from "@/app/api/client-incidents/[id]/client-ticket/route";
import { POST as postUpdate } from "@/app/api/client-incidents/[id]/updates/route";
import { POST as approveUpdate } from "@/app/api/client-incidents/[id]/updates/[updateId]/review/route";
import { POST as setStatus } from "@/app/api/client-incidents/[id]/status/route";
import { POST as sendDraft } from "@/app/api/client-incidents/drafts/[draftId]/send/route";
import { POST as closeRoute } from "@/app/api/work-items/[id]/close/route";
import { syncRuleCatalogue } from "@/modules/alerting/engine";
import { ingestPortalComments } from "@/modules/client-incidents/portal-comments";

const p = () => db.client;
const add = (m: string, data: Record<string, unknown>) => p()[m].create({ data });
const req = (url: string, method: string, body?: unknown) => new NextRequest(`http://localhost${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

type Call = { method: string; path: string; body: Record<string, unknown> | null };
const jsm = { calls: [] as Call[], n: 0, comments: [] as Array<Record<string, unknown>>, orgUsers: [{ accountId: "cust-acme-1" }] as Array<{ accountId: string }> };

function stubAtlassian() {
  vi.stubGlobal("fetch", vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(input.toString());
    const c: Call = { method: init?.method ?? "GET", path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null };
    jsm.calls.push(c);
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
    if (c.method === "POST" && c.path === "/rest/api/3/issue") return json({ id: "1", key: `OPS-${++jsm.n}` }, 201);
    if (c.method === "POST" && c.path === "/rest/servicedeskapi/request") return json({ issueKey: `CS-${++jsm.n}`, issueId: "9", _links: { web: `https://example.atlassian.net/servicedesk/customer/portal/1/CS-${jsm.n}` } }, 201);
    if (c.method === "GET" && /\/organization\/\d+\/user$/.test(c.path)) return json({ values: jsm.orgUsers });
    if (c.method === "GET" && c.path.endsWith("/transition")) return json({ values: [{ id: "11", name: "Investigating" }, { id: "12", name: "Update provided" }, { id: "13", name: "Resolved" }] });
    if (c.method === "GET" && c.path.startsWith("/rest/servicedeskapi/request/") && c.path.endsWith("/comment")) return json({ values: jsm.comments });
    if (c.method === "GET" && c.path.endsWith("/transitions")) return json({ transitions: [{ id: "31", name: "Done", to: { statusCategory: { key: "done" } } }] });
    if (c.method === "POST" && c.path.endsWith("/comment")) return json({ id: `cm-${++jsm.n}` }, 201);
    return new Response(null, { status: 204 });
  }));
}

const jsmRequests = () => jsm.calls.filter((c) => c.method === "POST" && c.path === "/rest/servicedeskapi/request");
const publicComments = () => jsm.calls.filter((c) => c.method === "POST" && c.path.startsWith("/rest/servicedeskapi/request/") && c.path.endsWith("/comment") && c.body?.public === true);

const INTERNAL = "Internal: the settlement bot crashed after the key rotation. Blame the deploy of v2.3 last night.";
const base = (over: Record<string, unknown> = {}) => ({
  type: "incident",
  source: { kind: "slack", channelId: "C0ACME001", ts: "1758700000.000100" },
  severity: "P2",
  category: "settlement_failure",
  clientFacingSummary: "Your settlement for today's window is delayed. We are investigating with the exchange and will update you here.",
  internalDescription: INTERNAL,
  affectedReferences: ["req-123", "tx-456"],
  ...over,
});

beforeEach(async () => {
  p().__reset();
  CircuitBreaker.resetAll();
  slack.posts.length = 0;
  jsm.calls = [];
  jsm.n = 0;
  jsm.comments = [];
  jsm.orgUsers = [{ accountId: "cust-acme-1" }];
  auth.user = { id: "u1", name: "Op", email: "op@k.com", role: "employee", employeeId: "emp-1", team: null };
  stubAtlassian();
  for (const [key, value] of Object.entries({ "intake.jsm.serviceDeskId": "4", "clientIncidents.jsmRequestTypeId": "77", "intake.jsm.organizationFieldId": "customfield_10002", "intake.internalEmailDomains": ["firm.example"] })) {
    await add("appSetting", { key, value });
  }
  await add("jiraProjectConfig", { key: "OPS", name: "OPS", kind: "jira", enabled: true, issueTypeIds: { _default: "1" } });
  for (const [code, label, sensitive] of [["settlement_failure", "Settlement failure", false], ["kyt_alert", "KYT alert", true]] as const) {
    await add("incidentCategory", { code, label, complianceSensitive: sensitive, isActive: true, sortOrder: 0 });
  }
  await add("client", { id: "cl-acme", displayName: "Acme Capital", isActive: true, jsmOrganizationId: "501", custodyOrgId: "org-acme", custodyAccountNos: ["ACC-1001"] });
  await add("client", { id: "cl-beta", displayName: "Beta Fund", isActive: true, jsmOrganizationId: "502", custodyOrgId: "org-beta", custodyAccountNos: ["ACC-2002"] });
  await add("client", { id: "cl-nojsm", displayName: "Gamma Ltd", isActive: true, jsmOrganizationId: null });
  await add("slackChannel", { id: "sc-acme", channelId: "C0ACME001", channelName: "acme", channelType: "client", purpose: "client", clientId: "cl-acme", isActive: true });
  await add("slackChannel", { id: "sc-x", channelId: "C0UNMAP01", channelName: "x", channelType: "client", purpose: "client", clientId: null, isActive: true });
  await add("clientChannel", { clientId: "cl-acme", kind: "email_domain", ref: "acme.example" });
  await add("clientChannel", { clientId: "cl-acme", kind: "jsm_participant", ref: "cust-acme-1" });
  await add("sourceRecord", { source: "graph_mail", kind: "mail_message", externalId: "<m1@acme.example>", fields: { mailbox: "custody", from: "ops@acme.example", message: { id: "AAMk-1", conversationId: "conv-1" } } });
  await syncRuleCatalogue();
  await p().alertRule.updateMany({ where: { code: { in: ["ALR-CLI-01", "ALR-CLI-03"] } }, data: { enabled: true } });
});
afterEach(() => vi.unstubAllGlobals());

async function raiseOk(body: Record<string, unknown> = base()) {
  const res = await raise(req("/api/client-incidents", "POST", body));
  const json = await res.json();
  expect(res.status, JSON.stringify(json)).toBe(201);
  return json.data as { id: string; ticketKey: string; clientTicket: { key: string; url: string } | null; withheld: boolean; draftId: string | null; warnings: string[] };
}

describe("raising from a message (§9.7)", () => {
  it("from a Slack message in a mapped client channel: one internal WorkItem, one internal ticket, one JSM request in that client's organisation, portal URL stored", async () => {
    const out = await raiseOk();
    const items = await p().workItem.findMany({ where: { kind: { in: ["client_incident", "client_risk"] } } });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "client_incident", clientId: "cl-acme", priority: "P2", ticketKey: "OPS-1", clientTicketKey: "CS-2", clientTicketUrl: "https://example.atlassian.net/servicedesk/customer/portal/1/CS-2" });
    expect(items[0].sourceMessageRef).toBe("https://custody.slack.com/archives/C0ACME001/p1758700000000100");
    expect(jsm.calls.filter((c) => c.path === "/rest/api/3/issue")).toHaveLength(1);
    const [request] = jsmRequests();
    expect(request.body).toMatchObject({ serviceDeskId: "4", requestTypeId: "77", requestParticipants: ["cust-acme-1"], requestFieldValues: { customfield_10002: [501] } });
    expect(out.clientTicket?.key).toBe("CS-2");
  });

  it("from a shared-mailbox email: the client is resolved from the sender domain", async () => {
    await raiseOk(base({ source: { kind: "email", messageRecordId: "<m1@acme.example>" }, type: "risk", category: "settlement_failure" }));
    const [item] = await p().workItem.findMany({ where: { kind: "client_risk" } });
    expect(item).toMatchObject({ clientId: "cl-acme", sourceMessageRef: "AAMk-1", clientTicketKey: expect.stringMatching(/^CS-/) });
    expect(jsmRequests()).toHaveLength(1);
  });

  it("blocks an unmapped channel or sender with 422", async () => {
    let res = await raise(req("/api/client-incidents", "POST", base({ source: { kind: "slack", channelId: "C0UNMAP01", ts: "1758700000.000100" } })));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/Map this channel or sender to a client first/);
    await add("sourceRecord", { source: "graph_mail", kind: "mail_message", externalId: "<m2@unknown.example>", fields: { mailbox: "custody", from: "x@unknown.example", message: { id: "AAMk-2" } } });
    res = await raise(req("/api/client-incidents", "POST", base({ source: { kind: "email", messageRecordId: "<m2@unknown.example>" } })));
    expect(res.status).toBe(422);
    const ctxRes = await contextGet(req("/api/client-incidents/context?kind=slack&channelId=C0UNMAP01&ts=1758700000.000100", "GET"));
    expect(ctxRes.status).toBe(422);
    expect(await p().workItem.count()).toBe(0);
  });

  it("warns when the client organisation has no portal users", async () => {
    jsm.orgUsers = [];
    await p().clientChannel.deleteMany({ where: { kind: "jsm_participant" } });
    const out = await raiseOk();
    expect(out.warnings.join(" ")).toMatch(/No portal users for this client/);
  });
});

describe("compliance-sensitive-blocks-client-ticket", () => {
  it("creates no JSM request, alerts Compliance, and needs an admin with a Compliance decision reference to create one later", async () => {
    const out = await raiseOk(base({ category: "kyt_alert" }));
    expect(out).toMatchObject({ withheld: true, clientTicket: null, draftId: null });
    expect(out.warnings).toContain("Client ticket withheld pending Compliance decision (tipping-off risk)");
    expect(jsmRequests()).toHaveLength(0);
    const [item] = await p().workItem.findMany({ where: { kind: "client_incident" } });
    expect(item.metadata).toMatchObject({ clientTicketBlocked: "compliance_sensitive" });
    expect(await p().alert.findMany({ where: { ruleCode: "ALR-CLI-03" } })).toEqual([expect.objectContaining({ severity: "critical", workItemId: item.id })]);

    // Without a decision reference: refused.
    let res = await clientTicket(req(`/api/client-incidents/${String(item.id)}/client-ticket`, "POST", {}), ctx({ id: String(item.id) }));
    expect(res.status).toBe(422);
    // A non-admin with a reference: refused.
    res = await clientTicket(req(`/api/client-incidents/${String(item.id)}/client-ticket`, "POST", { complianceDecisionRef: "COMP-2026-17" }), ctx({ id: String(item.id) }));
    expect(res.status).toBe(422);
    expect(jsmRequests()).toHaveLength(0);
    // Admin with a reference: created and audit-logged.
    auth.user = { ...auth.user, id: "u-admin", role: "admin", employeeId: "emp-admin" };
    res = await clientTicket(req(`/api/client-incidents/${String(item.id)}/client-ticket`, "POST", { complianceDecisionRef: "COMP-2026-17" }), ctx({ id: String(item.id) }));
    expect(res.status).toBe(201);
    expect(jsmRequests()).toHaveLength(1);
    const audit = await p().auditLog.findMany({ where: { action: "client_ticket_released_after_compliance_decision" } });
    expect(JSON.parse(audit[0].details as string).after.complianceDecisionRef).toBe("COMP-2026-17");
  });
});

describe("client-ticket-scoped-to-one-client", () => {
  it("blocks client-facing text that names another client (or its account number) before any JSM call", async () => {
    for (const leak of ["Beta Fund is also affected.", "Same issue as account ACC-2002."]) {
      const res = await raise(req("/api/client-incidents", "POST", base({ clientFacingSummary: `Your settlement is delayed. ${leak}` })));
      expect(res.status).toBe(422);
      expect((await res.json()).error).toMatch(/mentions another client/);
    }
    expect(jsmRequests()).toHaveLength(0);
    expect(await p().workItem.count()).toBe(0);
  });

  it("refuses request participants outside the client's organisation", async () => {
    jsm.orgUsers = [{ accountId: "someone-else" }];
    const out = await raiseOk();
    expect(out.clientTicket).toBeNull();
    expect(out.warnings.join(" ")).toMatch(/not in this client's JSM organisation/);
    expect(jsmRequests()).toHaveLength(0);
  });
});

describe("no-auto-public-comments", () => {
  it("never puts internal description text in the JSM request or public comments", async () => {
    const out = await raiseOk();
    const [request] = jsmRequests();
    expect(JSON.stringify(request.body)).not.toContain("settlement bot crashed");
    expect(JSON.stringify(request.body)).not.toContain("req-123");
    expect(publicComments()).toHaveLength(0); // raising posts nothing public

    const res = await postUpdate(req(`/api/client-incidents/${out.id}/updates`, "POST", { body: "Update: the settlement bot crashed after the key rotation. Blame the deploy of v2.3 last night." }), ctx({ id: out.id }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/internal description text/);
    expect(publicComments()).toHaveLength(0);
  });

  it("does not send the client notification until the operator clicks Send", async () => {
    const out = await raiseOk();
    expect(out.draftId).toBeTruthy();
    expect(slack.posts).toHaveLength(0);
    const draft = await p().outboundMessageDraft.findUnique({ where: { id: out.draftId! } });
    expect(draft).toMatchObject({ status: "draft", channel: "slack", body: `We've logged this as CS-2. You can follow progress here: https://example.atlassian.net/servicedesk/customer/portal/1/CS-2` });

    const res = await sendDraft(req(`/api/client-incidents/drafts/${out.draftId}/send`, "POST", { body: "We've logged this as CS-2. Follow it here: https://example.atlassian.net/servicedesk/customer/portal/1/CS-2" }), ctx({ draftId: out.draftId! }));
    expect(res.status).toBe(200);
    expect(slack.posts).toEqual([{ channel: "C0ACME001", thread_ts: "1758700000.000100", text: expect.stringContaining("CS-2") }]);
  });

  it("does not send email replies unless Graph sending is enabled; the operator can record a manual send", async () => {
    const out = await raiseOk(base({ source: { kind: "email", messageRecordId: "<m1@acme.example>" } }));
    let res = await sendDraft(req(`/api/client-incidents/drafts/${out.draftId}/send`, "POST", { body: "Logged as CS-2, follow it here." }), ctx({ draftId: out.draftId! }));
    expect(res.status).toBe(409);
    res = await sendDraft(req(`/api/client-incidents/drafts/${out.draftId}/send`, "POST", { body: "Logged as CS-2, follow it here.", markSentManually: true }), ctx({ draftId: out.draftId! }));
    expect(res.status).toBe(200);
  });
});

describe("client updates and statuses", () => {
  it("rejects a P1 public update without a second approver; the writer cannot approve their own; a second team member can", async () => {
    const out = await raiseOk(base({ severity: "P1" }));
    const res = await postUpdate(req(`/api/client-incidents/${out.id}/updates`, "POST", { body: "We have contacted the exchange and expect an answer within the hour.", targetStatus: "Investigating" }), ctx({ id: out.id }));
    expect(res.status).toBe(201);
    const update = (await res.json()).data;
    expect(update.status).toBe("pending_approval");
    expect(publicComments()).toHaveLength(0);

    let approve = await approveUpdate(req("/x", "POST"), ctx({ id: out.id, updateId: update.id }));
    expect(approve.status).toBe(422);
    expect(publicComments()).toHaveLength(0);

    auth.user = { ...auth.user, id: "u2", employeeId: "emp-2" };
    approve = await approveUpdate(req("/x", "POST"), ctx({ id: out.id, updateId: update.id }));
    expect(approve.status).toBe(200);
    expect(publicComments()).toEqual([expect.objectContaining({ path: "/rest/servicedeskapi/request/CS-2/comment", body: { body: "We have contacted the exchange and expect an answer within the hour.", public: true } })]);
    // Mirrored as an internal comment on the internal ticket, and the client status moved.
    expect(jsm.calls.some((c) => c.path === "/rest/api/3/issue/OPS-1/comment")).toBe(true);
    expect(jsm.calls.some((c) => c.method === "POST" && c.path === "/rest/servicedeskapi/request/CS-2/transition" && c.body?.id === "11")).toBe(true);
  });

  it("posts a P2 update directly", async () => {
    const out = await raiseOk();
    const res = await postUpdate(req(`/api/client-incidents/${out.id}/updates`, "POST", { body: "The exchange has confirmed the cause and is fixing it." }), ctx({ id: out.id }));
    expect((await res.json()).data.status).toBe("posted");
    expect(publicComments()).toHaveLength(1);
  });

  it("moves the client request only through the four client-visible statuses", async () => {
    const out = await raiseOk();
    const bad = await setStatus(req("/x", "POST", { status: "Closed" }), ctx({ id: out.id }));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error).toBe("Client-visible status must be one of: Received, Investigating, Update provided, Resolved.");
    const early = await setStatus(req("/x", "POST", { status: "Resolved" }), ctx({ id: out.id }));
    expect(early.status).toBe(409);
    const ok = await setStatus(req("/x", "POST", { status: "Update provided" }), ctx({ id: out.id }));
    expect(ok.status).toBe(200);
    expect(jsm.calls.filter((c) => c.method === "POST" && c.path.endsWith("/transition")).map((c) => c.body?.id)).toEqual(["12"]);
  });

  it("closing requires the write-up and a client resolution message, which is posted and moves the request to Resolved", async () => {
    const out = await raiseOk();
    const writeUp = { resolutionNote: "Exchange settled late; funds received at 11:40.", rootCause: "vendor_issue", riskScore: "Low" };
    let res = await closeRoute(req(`/api/work-items/${out.id}/close`, "POST", writeUp), ctx({ id: out.id }));
    expect(res.status).toBe(422);
    expect((await res.json()).issues.join(" ")).toMatch(/client-facing resolution message/);
    res = await closeRoute(req(`/api/work-items/${out.id}/close`, "POST", { ...writeUp, clientResolutionMessage: "Your settlement completed at 11:40 today. No action is needed." }), ctx({ id: out.id }));
    expect(res.status).toBe(200);
    expect(publicComments().at(-1)!.body).toEqual({ body: "Your settlement completed at 11:40 today. No action is needed.", public: true });
    expect(jsm.calls.some((c) => c.method === "POST" && c.path === "/rest/servicedeskapi/request/CS-2/transition" && c.body?.id === "13")).toBe(true);
    expect((await p().workItem.findUnique({ where: { id: out.id } }))!.state).toBe("closed");
  });
});

describe("client portal comments", () => {
  it("ingests a client's portal comment once and restarts the first-response clock", async () => {
    const out = await raiseOk();
    await p().workItem.update({ where: { id: out.id }, data: { firstResponseAt: new Date() } });
    jsm.comments = [
      { id: "cm-2", body: "our own", public: true, author: { emailAddress: "svc@example.com" } },
      { id: "cm-50", body: "Any news? We need this today.", public: true, author: { emailAddress: "ops@acme.example" }, created: { iso8601: "2026-09-24T09:00:00Z" } },
      { id: "cm-51", body: "internal agent note", public: true, author: { emailAddress: "agent@firm.example" } },
    ];
    const item = await p().workItem.findUnique({ where: { id: out.id } });
    await p().workItem.update({ where: { id: out.id }, data: { metadata: { ...(item!.metadata as Record<string, unknown>), postedCommentIds: ["cm-2"] } } });

    expect(await ingestPortalComments()).toEqual({ checked: 1, newComments: 1 });
    expect(await ingestPortalComments()).toEqual({ checked: 1, newComments: 0 });
    const after = await p().workItem.findUnique({ where: { id: out.id } });
    expect(after!.firstResponseAt).toBeNull();
    expect(after!.metadata).toMatchObject({ firstResponseClockStartedAt: "2026-09-24T09:00:00.000Z" });
  });
});
