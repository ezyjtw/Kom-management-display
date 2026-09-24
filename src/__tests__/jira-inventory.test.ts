/**
 * Phase 10 (spec §15): read-only Jira inventory. Proves it only reads
 * (GET plus the JQL search), handles unreadable parts, and flags saved
 * filters and dashboards that use issue types proposed for consolidation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const envVars = vi.hoisted(() => ({ ATLASSIAN_BASE_URL: "https://example.atlassian.net", ATLASSIAN_EMAIL: "svc@example.com", ATLASSIAN_API_TOKEN: "t" } as Record<string, string | undefined>));
vi.mock("@/lib/env", () => ({ env: (k: string) => envVars[k] }));
vi.mock("@/lib/http/allowed-hosts", () => ({ getAllowedHosts: () => new Set(["example.atlassian.net"]) }));

import { assertInventoryPermitted, INVENTORY_ALLOWLIST } from "@/modules/jira-inventory/client";
import { issueTypesInJql, projectsInJql } from "@/modules/jira-inventory/jql";
import { collectInventory, filterIdsIn } from "@/modules/jira-inventory/collect";
import { renderInventory } from "@/modules/jira-inventory/report";

type Call = { method: string; path: string; query: Record<string, string>; body: Record<string, unknown> | null };
let calls: Call[] = [];

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });

function stubJira() {
  vi.stubGlobal("fetch", vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(input.toString());
    const c: Call = { method: init?.method ?? "GET", path: url.pathname, query: Object.fromEntries(url.searchParams), body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(c);
    const p = c.path;
    if (p === "/rest/api/3/project/OPS") return json({ id: "100", key: "OPS", name: "Transaction Operations", issueTypes: [{ id: "1", name: "Task" }, { id: "2", name: "Sub-task", subtask: true }, { id: "3", name: "Daily Check" }] });
    if (p === "/rest/api/3/project/OLD") return json({ id: "200", key: "OLD", name: "Old project", issueTypes: [{ id: "9", name: "Task" }] });
    if (p === "/rest/api/3/project/NOPE") return json({ errorMessages: ["No project"] }, 404);
    if (p === "/rest/agile/1.0/board") return json({ values: c.query.projectKeyOrId === "OPS" ? [{ id: 5, name: "OPS board", type: "kanban" }] : [], isLast: true });
    if (p === "/rest/api/3/workflowscheme/project") {
      if (c.query.projectId === "200") return json({ errorMessages: ["forbidden"] }, 403);
      return json({ values: [{ workflowScheme: { name: "OPS scheme", defaultWorkflow: "OPS workflow", issueTypeMappings: { "3": "Daily check workflow" } } }] });
    }
    if (p === "/rest/api/3/search/jql") {
      const jql = String(c.body?.jql);
      if (jql.includes("ORDER BY created DESC")) return json({ issues: jql.includes("OLD") ? [{ fields: { created: "2025-01-02T10:00:00.000+0000" } }] : [{ fields: { created: "2026-09-20T10:00:00.000+0000" } }] });
      if (jql.includes("OLD")) return json({ issues: [], isLast: true });
      if (!c.body?.nextPageToken) return json({ issues: [{ fields: { issuetype: { name: "Task" }, status: { name: "In Progress" } } }, { fields: { issuetype: { name: "Task" }, status: { name: "To Do" } } }], nextPageToken: "p2", isLast: false });
      return json({ issues: [{ fields: { issuetype: { name: "Task" }, status: { name: "To Do" } } }], isLast: true });
    }
    if (p === "/rest/api/3/user/search") return json(c.query.query === "ann@k.com" ? [{ accountId: "acc-ann", emailAddress: "ann@k.com" }] : []);
    if (p === "/rest/api/3/filter/search") return json({ values: [
      { id: "10001", name: "My daily checks", jql: 'project = OPS AND issuetype = "Daily Check" ORDER BY created', owner: { displayName: "Ann" } },
      { id: "10002", name: "All OPS", jql: "project in (OPS, OTC) AND statusCategory != Done", owner: { displayName: "Ann" } },
    ], isLast: true });
    if (p === "/rest/api/3/dashboard/search") return json({ values: [{ id: "7", name: "Ops dashboard" }, { id: "8", name: "Other" }], isLast: true });
    if (p === "/rest/api/3/dashboard/7/gadget") return json({ gadgets: [{ id: 70 }] });
    if (p === "/rest/api/3/dashboard/8/gadget") return json({ gadgets: [{ id: 80 }] });
    if (p === "/rest/api/3/dashboard/7/items/70/properties") return json({ keys: [{ key: "config" }] });
    if (p === "/rest/api/3/dashboard/8/items/80/properties") return json({ keys: [{ key: "config" }] });
    if (p === "/rest/api/3/dashboard/7/items/70/properties/config") return json({ key: "config", value: { filterId: "filter-10001", num: "10" } });
    if (p === "/rest/api/3/dashboard/8/items/80/properties/config") return json({ key: "config", value: { filterId: "filter-10002" } });
    return json({ errorMessages: [`unexpected ${p}`] }, 500);
  }));
}

beforeEach(() => {
  calls = [];
  stubJira();
});
afterEach(() => vi.unstubAllGlobals());

describe("JQL parsing", () => {
  it("finds issue types in = / in / != clauses, quoted or not", () => {
    expect(issueTypesInJql('project = OPS AND issuetype = "Daily Check"')).toEqual(["daily check"]);
    expect(issueTypesInJql("type in (Task, 'Sub-task') AND status = Open").sort()).toEqual(["sub-task", "task"]);
    expect(issueTypesInJql("issuetype != Epic OR issueType not in (Bug)").sort()).toEqual(["bug", "epic"]);
    expect(issueTypesInJql("project = OPS AND statusCategory != Done")).toEqual([]);
  });

  it("finds project keys", () => {
    expect(projectsInJql("project in (OPS, otc) AND x = 1").sort()).toEqual(["OPS", "OTC"]);
    expect(projectsInJql('project = "VND"')).toEqual(["VND"]);
  });

  it("finds filter references in gadget configuration", () => {
    expect(filterIdsIn({ filterId: "filter-10001" })).toEqual(["10001"]);
    expect(filterIdsIn({ filterId: 10003 })).toEqual(["10003"]);
    expect(filterIdsIn({ other: "x" })).toEqual([]);
  });
});

describe("read-only guarantee", () => {
  it("the inventory allowlist has no write endpoints (only GET, plus the JQL search)", () => {
    for (const e of INVENTORY_ALLOWLIST) {
      if (e.method !== "GET") expect(String(e.pattern)).toContain("search\\/jql");
    }
    expect(() => assertInventoryPermitted("PUT", "/rest/api/3/issue/OPS-1")).toThrow(/read-only/);
    expect(() => assertInventoryPermitted("POST", "/rest/api/3/issue")).toThrow(/read-only/);
    expect(() => assertInventoryPermitted("DELETE", "/rest/api/3/filter/10001")).toThrow(/read-only/);
    expect(() => assertInventoryPermitted("PUT", "/rest/api/3/workflowscheme/project")).toThrow(/read-only/);
  });

  it("a full run makes only GET requests and JQL searches", async () => {
    await collectInventory({ projects: ["OPS", "OLD", "NOPE"], teamEmails: ["ann@k.com", "ghost@k.com"] });
    expect(calls.length).toBeGreaterThan(10);
    expect(calls.filter((c) => !(c.method === "GET" || (c.method === "POST" && c.path === "/rest/api/3/search/jql")))).toEqual([]);
  });
});

describe("inventory and report", () => {
  it("collects boards, issue types, workflows, open counts (paged) and team filters, tolerating unreadable parts", async () => {
    const inv = await collectInventory({ projects: ["OPS", "OLD", "NOPE"], teamEmails: ["ann@k.com", "ghost@k.com"], now: new Date("2026-09-24T00:00:00Z") });
    const ops = inv.projects[0];
    expect(ops.boards.value).toEqual([{ id: 5, name: "OPS board", type: "kanban" }]);
    expect(ops.workflows.value[0]).toEqual({ scheme: "OPS scheme", defaultWorkflow: "OPS workflow", byIssueType: { "Daily Check": "Daily check workflow" } });
    expect(ops.openCounts.value).toEqual({ byTypeAndStatus: { Task: { "In Progress": 1, "To Do": 2 } }, total: 3, truncated: false });
    expect(inv.projects[1].workflows).toMatchObject({ ok: false, note: "not readable with the configured account (permission)" });
    expect(inv.projects[2]).toMatchObject({ found: false });
    expect(inv.teamUsers).toEqual({ requested: 2, resolved: 1, unresolved: 1 });
    expect(inv.filters.value.map((f) => f.id)).toEqual(["10002", "10001"]);
    expect(inv.dashboards.value).toEqual([{ id: "7", name: "Ops dashboard", filterIds: ["10001"] }, { id: "8", name: "Other", filterIds: ["10002"] }]);
    expect(ops.automation.note).toMatch(/CONFIRM-JIRA-AUTOMATION-API/);
  });

  it("flags filters and dashboards that use an issue type proposed for consolidation, and writes proposals for humans", async () => {
    const inv = await collectInventory({ projects: ["OPS", "OLD", "NOPE"], teamEmails: ["ann@k.com"], now: new Date("2026-09-24T00:00:00Z") });
    const md = renderInventory(inv, { issueTypes: [{ project: "OPS", issueType: "Daily Check", mergeInto: "Task" }] });
    expect(md).toContain("Do not change any Jira configuration");
    expect(md).toMatch(/\| My daily checks \(10001\) \| Ann \| OPS \| daily check \| \*\*yes\*\*: Daily Check \|/);
    expect(md).toContain("Filters at risk: My daily checks (10001).");
    expect(md).toContain("Dashboards using those filters: Ops dashboard (7).");
    expect(md).not.toContain("Other (8)");
    expect(md).toMatch(/OLD: no open issues and no new issue for \d+ days — candidate to retire or archive/);
    expect(md).toContain("NOPE: not readable with the inventory account");
    expect(md).toMatch(/OPS: issue types with no open issues \(Sub-task, Daily Check\)/);
  });

  it("says when no consolidation list has been agreed yet", async () => {
    const inv = await collectInventory({ projects: ["OPS"], teamEmails: [] });
    expect(renderInventory(inv, { issueTypes: [] })).toContain("TODO(CONFIRM-JIRA-CONSOLIDATION)");
  });
});
