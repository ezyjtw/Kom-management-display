/**
 * Spec §16.5, 16.7, 16.8, 16.9 (and 16.4): UAT outcome capture, GXS defects
 * confirmed by the tester, the /gx-sprints view and run permissions, sprint
 * metrics, the static "no GX execution" check, and the Komainu spec checks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
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
vi.mock("@/lib/sse", () => ({ emitWorkItemUpdate: () => undefined, emitAlert: () => undefined, broadcastEvent: () => undefined }));
const auth = vi.hoisted(() => ({ user: { id: "u-ann", name: "Ann", email: "ann@k.com", role: "employee", employeeId: "emp-ann", team: null } as Record<string, unknown> }));
vi.mock("@/lib/auth-user", () => ({ requireAuth: vi.fn(async () => auth.user) }));
vi.mock("@/lib/api/rate-limit-middleware", () => ({ checkRateLimit: () => null, RATE_LIMIT_PRESETS: { mutation: {}, read: {}, expensive: {} } }));

import { POST as closeRoute } from "@/app/api/work-items/[id]/close/route";
import { GET as defectGet, POST as defectPost } from "@/app/api/gx-sprints/defect/[workItemId]/route";
import { GET as sprintsGet } from "@/app/api/gx-sprints/route";
import { POST as runPost } from "@/app/api/gx-sprints/run/route";
import { syncRuleCatalogue } from "@/modules/alerting/engine";
import { signOffAt, sprintUat } from "@/modules/metrics/definitions";
import { checkContract, diffSpecs, type OpenApiDoc } from "@/lib/integrations/komainu-api/contract";

const p = () => db.client;
const add = (m: string, data: Record<string, unknown>) => p()[m].create({ data });
const req = (method: string, body?: unknown) => new NextRequest("http://localhost/x", { method, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = <T extends Record<string, string>>(v: T) => ({ params: Promise.resolve(v) });
const calls: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = [];

beforeEach(async () => {
  p().__reset();
  calls.length = 0;
  auth.user = { id: "u-ann", name: "Ann", email: "ann@k.com", role: "employee", employeeId: "emp-ann", team: null };
  vi.stubGlobal("fetch", vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(input.toString());
    calls.push({ method: init?.method ?? "GET", path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
    if (url.pathname.endsWith("/transitions") && (init?.method ?? "GET") === "GET") return json({ transitions: [{ id: "31", name: "Done", to: { statusCategory: { key: "done" } } }] });
    if (init?.method === "POST" && url.pathname === "/rest/api/3/issue") return json({ id: "1", key: "GXS-77" }, 201);
    return new Response(null, { status: 204 });
  }));
  await add("employee", { id: "emp-ann", name: "Ann Operator", email: "ann@k.com", role: "Analyst", team: "TransactionOperations", active: true });
  await add("appSetting", { key: "workItem.rootCauses", value: ["product_behaviour"] });
  await add("gxSprint", { id: "sp", sprint: "9.99", prodPlannedAt: new Date("2026-10-20T00:00:00Z") });
  await add("workItem", { id: "uat-1", kind: "uat_task", title: "[UAT 9.99] staking_change: ETH", taskCode: "UAT", sourceSystem: "gx_sprint", sourceId: "9.99:c1", clockStartedAt: new Date(), ticketKey: "TOPS-10", ticketSystem: "jira", state: "owned", metadata: { gxChangeId: "c1", gxSprint: "9.99", affectedTasks: ["CHK-16"] } });
  await add("gxChange", { id: "c1", sprintId: "sp", section: "Stake / Unstake", itemType: "staking_change", summary: "ETH: Unstake queue", detail: {}, rowHash: "h", qualifies: true, workItemId: "uat-1", uatTicketKey: "TOPS-10", gxJiraKeys: ["GXD-1"] });
  await syncRuleCatalogue();
  await p().alertRule.update({ where: { code: "ALR-UAT-03" }, data: { enabled: true } });
});
afterEach(() => vi.unstubAllGlobals());

const writeUp = (uat?: Record<string, unknown>) => ({ resolutionNote: "Tested in GX UAT against the batched unstake queue.", rootCause: "product_behaviour", riskScore: "low", uat });

describe("UAT outcome capture (spec §16.5)", () => {
  it("closing a UAT item needs an outcome and evidence", async () => {
    const res = await closeRoute(req("POST", writeUp()), ctx({ id: "uat-1" }));
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toMatch(/Record the UAT outcome/);
    expect((await closeRoute(req("POST", writeUp({ outcome: "pass", evidence: "" })), ctx({ id: "uat-1" }))).status).toBe(422);
  });

  it("a fail without a linked GXS ticket is rejected with 422 (acceptance test)", async () => {
    const res = await closeRoute(req("POST", writeUp({ outcome: "fail", evidence: "screenshot-1" })), ctx({ id: "uat-1" }));
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toMatch(/GXS defect/);
    expect(calls.some((c) => c.path.endsWith("/transitions") && c.method === "POST")).toBe(false);
  });

  it("a fail with its GXS defect closes, records the outcome, links the defect and raises ALR-UAT-03", async () => {
    const res = await closeRoute(req("POST", writeUp({ outcome: "fail", evidence: "screenshot-1", defectKey: "gxs-77" })), ctx({ id: "uat-1" }));
    expect(res.status).toBe(200);
    expect((await p().gxChange.findUnique({ where: { id: "c1" } }))!.uatOutcome).toBe("fail");
    expect((await p().workItem.findUnique({ where: { id: "uat-1" } }))!.metadata).toMatchObject({ uatOutcome: "fail", uatEvidence: "screenshot-1", gxsDefectKey: "GXS-77" });
    expect(calls.some((c) => c.path === "/rest/api/3/issueLink" && JSON.stringify(c.body).includes("GXS-77"))).toBe(true);
    expect((await p().alert.findMany({ where: { ruleCode: "ALR-UAT-03" } }))).toHaveLength(1);
  });

  it("the GXS defect is drafted, and only created when the tester confirms", async () => {
    const draft = (await (await defectGet(req("GET"), ctx({ workItemId: "uat-1" }))).json()).data;
    expect(draft.summary).toBe("[Sprint 9.99 UAT] ETH: Unstake queue");
    expect(draft.description).toContain("GXD-1");
    expect((await defectPost(req("POST", { summary: draft.summary, description: draft.description }), ctx({ workItemId: "uat-1" }))).status).toBe(400);
    expect((await defectPost(req("POST", { ...draft, confirm: true }), ctx({ workItemId: "uat-1" }))).status).toBe(409); // GXS not configured
    await add("jiraProjectConfig", { key: "GXS", name: "GX Service Management", enabled: false, issueTypeIds: { Bug: "10004" } });
    const res = await defectPost(req("POST", { ...draft, confirm: true }), ctx({ workItemId: "uat-1" }));
    expect(res.status).toBe(201);
    expect((await res.json()).data.key).toBe("GXS-77");
    const create = calls.find((c) => c.method === "POST" && c.path === "/rest/api/3/issue")!;
    expect((create.body!.fields as { project: { key: string } }).project.key).toBe("GXS");
    expect((await p().workItem.findUnique({ where: { id: "uat-1" } }))!.metadata).toMatchObject({ gxsDefectKey: "GXS-77" });
  });
});

describe("/gx-sprints (spec §16.7)", () => {
  it("shows the gate and lets only leads and admins run the intake", async () => {
    const view = (await (await sprintsGet(req("GET"))).json()).data;
    expect(view.canRun).toBe(false);
    expect(view.sprints[0]).toMatchObject({ sprint: "9.99", gate: "amber", tasks: [], outcomes: { open: 1 } });
    await p().gxChange.update({ where: { id: "c1" }, data: { uatOutcome: "pass" } });
    expect((await (await sprintsGet(req("GET"))).json()).data.sprints[0].gate).toBe("green");
    expect((await runPost(req("POST", {}))).status).toBe(403);
    auth.user = { ...auth.user, role: "lead" };
    const run = await runPost(req("POST", {}));
    expect(run.status).toBe(200);
    expect((await run.json()).data.skipped.join(" ")).toMatch(/Confluence|KMNC/);
  });
});

describe("GX sprint metrics (spec §16.8)", () => {
  const d = (s: string) => new Date(s);
  it("completion before PROD, fails, defects and items added after sign-off", () => {
    const items = [
      { createdAt: d("2026-10-01"), resolvedAt: d("2026-10-10"), outcome: "pass", defect: false, hasTicket: true },
      { createdAt: d("2026-10-01"), resolvedAt: d("2026-10-12"), outcome: "fail", defect: true, hasTicket: true },
      { createdAt: d("2026-10-14"), resolvedAt: d("2026-10-22"), outcome: "pass", defect: false, hasTicket: true },
    ];
    expect(signOffAt(items)?.toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(sprintUat(items, d("2026-10-20"))).toEqual({ changeItems: 3, uatTickets: 3, completedBeforeProdPct: 66.7, fails: 1, defectsRaised: 1, addedAfterSignOff: 1 });
  });
});

describe("no GX execution (spec §16.9 static check)", () => {
  const dir = "src/modules/gx-sprints";
  const sources = readdirSync(dir).map((f) => ({ f, text: readFileSync(`${dir}/${f}`, "utf8") }));
  const ALLOWED: Record<string, string[]> = {
    "@/lib/integrations/atlassian/client": ["searchIssues", "isAtlassianConfigured", "linkIssues", "createIssue", "browseUrl", "JiraIssue"],
    "@/lib/integrations/confluence/client": ["getPage", "searchPages", "pageUrl", "isConfluenceConfigured"],
  };

  it("only Confluence GET, Jira search/GET and Jira issue/comment/link writes are used", () => {
    for (const { f, text } of sources) {
      expect(text, `${f} calls fetch directly`).not.toMatch(/\bfetch\(/);
      expect(text, `${f} imports the Komainu client`).not.toMatch(/from\s+"[^"]*(komainu-api|integrations\/komainu)/);
      expect(text, `${f} uses the HTTP client directly`).not.toMatch(/from\s+"@\/lib\/http\//);
      for (const m of text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
        const allowed = ALLOWED[m[2]];
        if (m[2].includes("/integrations/") && !allowed) throw new Error(`${f} imports ${m[2]}`);
        if (!allowed) continue;
        for (const name of m[1].split(",").map((s) => s.replace(/\btype\b/, "").trim()).filter(Boolean)) {
          expect(allowed, `${f} imports ${name} from ${m[2]}`).toContain(name);
        }
      }
    }
  });

  it("the Confluence client allowlist is GET-only", async () => {
    const { CONFLUENCE_ALLOWLIST, assertConfluencePermitted } = await import("@/lib/integrations/confluence/client");
    expect(CONFLUENCE_ALLOWLIST.every((e) => e.method === "GET")).toBe(true);
    expect(() => assertConfluencePermitted("PUT", "/rest/api/content/1")).toThrow(/read-only/);
  });
});

describe("Komainu API spec checks (spec §16.4)", () => {
  const spec = (extra: Record<string, unknown> = {}, txFields = ["id", "direction", "asset", "amount", "status", "created_at", "tx_hash", "transaction_type", "organization", "account"]): OpenApiDoc => ({
    paths: {
      "/v1/custody/transactions": { get: { responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/TxPage" } } } } } } },
      ...extra,
    },
    components: { schemas: {
      TxPage: { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/Tx" } } } },
      Tx: { type: "object", properties: Object.fromEntries(txFields.map((f) => [f, { type: "string" }])) },
    } },
  });

  it("reports added write endpoints (except the token endpoint), paths and field changes", () => {
    const next = spec({ "/v1/custody/transactions/{id}/approve": { post: {} }, "/v1/auth/token": { post: {} } }, ["id", "direction", "asset", "amount", "status", "created_at", "tx_hash", "transaction_type", "organization", "account", "memo"]);
    const diff = diffSpecs(spec(), next);
    expect(diff.newWriteEndpoints).toEqual(["POST /v1/custody/transactions/{id}/approve"]);
    expect(diff.addedPaths).toEqual(["/v1/auth/token", "/v1/custody/transactions/{id}/approve"]);
    expect(diff.fieldChanges).toEqual([{ schema: "Tx", added: ["memo"], removed: [], typeChanged: [] }]);
  });

  it("the contract check finds missing depended-on fields and endpoints", () => {
    const issues = checkContract(spec({}, ["id", "direction", "asset", "status"]));
    expect(issues.filter((i) => i.kind === "missing_field").map((i) => i.detail)).toEqual(expect.arrayContaining(['field "amount" is not in the response items']));
    expect(issues.some((i) => i.kind === "missing_endpoint")).toBe(true);
  });
});
