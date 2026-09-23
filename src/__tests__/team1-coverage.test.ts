/**
 * Spec §12 Team 1: settlement matching view (read-only, H1), OES-06 exposure
 * band, incident tickets and Jira timeline comments, draft-only provider
 * comments, the FAB register behind module.fab, and kps:view.
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
const flags = vi.hoisted(() => ({ on: new Set<string>() }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: vi.fn(async (k: string) => flags.on.has(k)) }));
const auth = vi.hoisted(() => ({ user: { id: "u1", name: "Op", email: "op@k.com", role: "lead", employeeId: "emp-1", team: null } as Record<string, unknown> }));
vi.mock("@/lib/auth-user", () => ({ requireAuth: vi.fn(async () => auth.user) }));
vi.mock("@/lib/api/rate-limit-middleware", () => ({ checkRateLimit: () => null, RATE_LIMIT_PRESETS: { mutation: {} } }));

import { CircuitBreaker } from "@/lib/circuit-breaker";
import { buildSettlementView, CF39_NOTICE } from "@/modules/settlements/matching-view";
import * as settlementsRoute from "@/app/api/settlements/route";
import { POST as exposureBand } from "@/app/api/work-items/[id]/exposure-band/route";
import { closureIssues } from "@/modules/work-items/closure-rules";
import { incidentService, incidentTicketProject } from "@/modules/incidents/services/incident-service";
import { POST as rcaPost } from "@/app/api/rca/tickets/route";
import { GET as fabGet } from "@/app/api/fab/route";
import { POST as fabInstructionPost } from "@/app/api/fab/instructions/route";
import { GET as kpsGet } from "@/app/api/kps/route";

const p = () => db.client;
const add = (m: string, data: Record<string, unknown>) => p()[m].create({ data });
const req = (url: string, method: string, body?: unknown) => new NextRequest(`http://localhost${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const jira = { calls: [] as Array<{ method: string; path: string; body: unknown }>, n: 0 };
beforeEach(() => {
  p().__reset();
  flags.on.clear();
  CircuitBreaker.resetAll();
  auth.user = { id: "u1", name: "Op", email: "op@k.com", role: "lead", employeeId: "emp-1", team: null };
  jira.calls = [];
  jira.n = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(input.toString());
    const call = { method: init?.method ?? "GET", path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null };
    jira.calls.push(call);
    if (call.method === "POST" && call.path === "/rest/api/3/issue") return new Response(JSON.stringify({ id: "1", key: `${(call.body as { fields: { project: { key: string } } }).fields.project.key}-${++jira.n}` }), { status: 201 });
    return new Response(JSON.stringify({ id: "c" }), { status: 201 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("CHK-10 settlement matching view", () => {
  beforeEach(async () => {
    await add("oesWindow", { exchange: "okx", cron: "0 9 * * *", durationMins: 30, referenceTz: "UTC", isActive: true });
    await add("sourceRecord", { source: "komainu_api", kind: "portfolio", externalId: "pf-1", status: "ACTIVE", fields: { exchange: "okx" } });
    await add("sourceRecord", { source: "komainu_api", kind: "portfolio", externalId: "pf-2", status: "ACTIVE", fields: { exchange: "okx" } });
    await add("sourceRecord", { source: "komainu_api", kind: "settlement", externalId: "s-1", status: "FAILED", mappedStatus: "failed", occurredAt: new Date("2026-09-23T09:03:00Z"), lastSeenAt: new Date("2026-09-23T09:10:00Z"), fields: { exchange: "okx", portfolio_id: "pf-1" } });
    await add("sourceRecord", { source: "komainu_api", kind: "settlement", externalId: "s-x", status: "DONE", mappedStatus: "completed", occurredAt: new Date("2026-09-23T09:04:00Z"), lastSeenAt: new Date("2026-09-23T09:10:00Z"), fields: { exchange: "okx", portfolio_id: "pf-9" } });
  });

  it("has one row per expected portfolio per window, plus unmatched settlements", async () => {
    const view = await buildSettlementView("2026-09-23", new Date("2026-09-23T12:00:00Z"));
    expect(view.rows.map((r) => [r.windowKey, r.portfolioId, r.settlementId, r.mappedStatus])).toEqual([
      ["2026-09-23:okx:09:00Z", "pf-1", "s-1", "failed"],
      ["2026-09-23:okx:09:00Z", "pf-2", null, "no_record"],
      ["2026-09-23:okx:09:00Z", "pf-9", "s-x", "completed"],
    ]);
    expect(view.rows[0].timeline.map((t) => t.label)).toEqual(["Window opens (okx)", "Settlement started", "Last seen: failed (FAILED)"]);
    expect(view.cf39).toBe(CF39_NOTICE);
  });

  it("offers only a read endpoint (no maker/checker approval, H1)", () => {
    expect(Object.keys(settlementsRoute).filter((k) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(k))).toEqual(["GET"]);
  });

  it("shows the ALR-OES-06 exposure step and requires the band before closure", async () => {
    await add("workItem", { id: "wi-oes", kind: "oes_settlement", title: "Settlement failed", taskCode: "OES", sourceSystem: "alert", sourceId: "x", ticketKey: "TOPS-9", ticketSystem: "jira", exposureUsd: 250000, clockStartedAt: new Date() });
    await add("alert", { type: "ALR-OES-06", ruleCode: "ALR-OES-06", dedupeKey: "s-1", message: "EOD", severity: "critical", workItemId: "wi-oes" });
    const row = (await buildSettlementView("2026-09-23", new Date("2026-09-23T17:00:00Z"))).rows[0];
    expect(row.exposure).toEqual({ workItemId: "wi-oes", exposureUsd: 250000, band: null });

    const writeUp = { resolutionNote: "Exchange settled the next morning.", rootCause: "vendor_issue", riskScore: "Low" };
    const item = await p().workItem.findUnique({ where: { id: "wi-oes" } });
    expect(await closureIssues(item as never, { writeUp })).toContain("Choose the client exposure band (ALR-OES-06) before closing.");

    const res = await exposureBand(req("/api/work-items/wi-oes/exposure-band", "POST", { band: "USD 100k–1m" }), ctx("wi-oes"));
    expect(res.status).toBe(200);
    expect(jira.calls.some((c) => c.path === "/rest/api/3/issue/TOPS-9/comment")).toBe(true);
    const after = await p().workItem.findUnique({ where: { id: "wi-oes" } });
    expect(await closureIssues(after as never, { writeUp })).toEqual([]);
  });

  it("rejects a band outside the configured list", async () => {
    await add("appSetting", { key: "oes.exposureBands", value: ["Low", "High"] });
    await add("workItem", { id: "wi-oes", kind: "oes_settlement", title: "x", taskCode: "OES", sourceSystem: "alert", sourceId: "x", clockStartedAt: new Date() });
    const res = await exposureBand(req("/api/work-items/wi-oes/exposure-band", "POST", { band: "Medium" }), ctx("wi-oes"));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("Exposure band must be one of: Low, High.");
  });
});

describe("CHK-11 incidents", () => {
  beforeEach(async () => {
    for (const key of ["GXS", "VSR"]) await add("jiraProjectConfig", { key, name: key, kind: "jira", enabled: true, issueTypeIds: { _default: "1" } });
  });

  it("routes GX issues to GXS and other providers to VSR", () => {
    expect(incidentTicketProject("GX")).toBe("GXS");
    expect(incidentTicketProject("Fireblocks")).toBe("VSR");
  });

  it("opens the incident's ticket and posts timeline updates as Jira comments first", async () => {
    const inc = await incidentService.createIncident({ title: "Signing degraded", provider: "Fireblocks", severity: "high", reportedById: "emp-1" } as never);
    const saved = await p().incident.findUnique({ where: { id: inc.id } });
    const wi = await p().workItem.findUnique({ where: { id: saved!.workItemId } });
    expect(wi).toMatchObject({ kind: "incident", ticketKey: "VSR-1", taskCode: "CHK-11" });

    await incidentService.addUpdate(inc.id, "emp-1", "Vendor confirmed a fix is rolling out", "update");
    expect(jira.calls.at(-1)).toMatchObject({ method: "POST", path: "/rest/api/3/issue/VSR-1/comment" });
    expect(await p().incidentUpdate.count()).toBe(1);
  });

  it("does not record the update when Jira refuses it (write-first)", async () => {
    const inc = await incidentService.createIncident({ title: "Signing degraded", provider: "Fireblocks", severity: "high", reportedById: "emp-1" } as never);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 400 })));
    await expect(incidentService.addUpdate(inc.id, "emp-1", "update", "update")).rejects.toThrow(/Comment failed/);
    expect(await p().incidentUpdate.count()).toBe(0);
  });
});

describe("CHK-12 provider comments are drafts only", () => {
  it("never posts to a provider ticket; a person records that they sent it", async () => {
    const inc = await add("incident", { title: "x", provider: "Ledger", reportedById: "emp-1", externalTicketRef: "LED-5", externalTicketUrl: "https://ledger.atlassian.net/browse/LED-5", externalTicketStatus: "Done", rcaStatus: "awaiting_rca" });
    let res = await rcaPost(req("/api/rca/tickets", "POST", { incidentId: inc.id, action: "dispute", reason: "RCA not delivered", draftComment: "Please reopen until the RCA is shared." }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { sent: false } });
    expect(jira.calls).toHaveLength(0);
    res = await rcaPost(req("/api/rca/tickets", "POST", { incidentId: inc.id, action: "comment_sent" }));
    expect(res.status).toBe(200);
    const events = await p().externalTicketEvent.findMany();
    expect(events.map((e) => e.event)).toEqual(["disputed", "comment_sent_by_human"]);
    expect(events[0].jiraComment).toMatch(/^DRAFT \(not sent\)/);
  });

  it("rejects unknown actions", async () => {
    const res = await rcaPost(req("/api/rca/tickets", "POST", { incidentId: "i", action: "post_to_provider" }));
    expect(res.status).toBe(400);
  });
});

describe("TASK-FAB register (module.fab)", () => {
  const instruction = { messageType: "STL_INS", reference: "AGR-1", instructionType: "OPEN", direction: "RECEIVE", asset: "USDC", amount: 1000, valueDate: "2026-09-23", receivedAt: "2026-09-23T08:00:00Z" };

  it("is not found while module.fab is off", async () => {
    expect((await fabGet(req("/api/fab", "GET"))).status).toBe(404);
    expect((await fabInstructionPost(req("/api/fab/instructions", "POST", instruction))).status).toBe(404);
  });

  it("records an instruction and opens one ticket per reference", async () => {
    flags.on.add("module.fab");
    await add("appSetting", { key: "fab.ticketProject", value: "FAB" });
    await add("jiraProjectConfig", { key: "FAB", name: "FAB", kind: "jira", enabled: true, issueTypeIds: { _default: "1" } });
    const res = await fabInstructionPost(req("/api/fab/instructions", "POST", instruction));
    expect(res.status).toBe(201);
    const row = (await res.json()).data;
    const wi = await p().workItem.findUnique({ where: { id: row.workItemId } });
    expect(wi).toMatchObject({ kind: "fab_instruction", ticketKey: "FAB-1", sourceSystem: "fab", sourceId: "AGR-1" });
    expect((await fabInstructionPost(req("/api/fab/instructions", "POST", instruction))).status).toBe(409);
  });

  it("masks tx hashes in the register view", async () => {
    flags.on.add("module.fab");
    await add("fabSettlementLog", { reference: "AGR-1", status: "COMPLETED", txHash: "0x" + "ab".repeat(32), kytStatus: "none", occurredAt: new Date(), notes: "" });
    const data = (await (await fabGet(req("/api/fab", "GET"))).json()).data;
    expect(data.settlements[0].txHash).toBe("0xab…abab");
  });
});

describe("CHK-09K kps:view", () => {
  it("refuses users without kps:view and shows the CF-03 banner to those with it", async () => {
    expect((await kpsGet()).status).toBe(403);
    auth.user = { ...auth.user, role: "admin" };
    const body = await (await kpsGet()).json();
    expect(body.data.notice).toMatch(/CF-03/);
  });
});
