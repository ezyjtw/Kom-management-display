/**
 * Jira / JSM connector (spec §8.2) against a stubbed fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const envVars = vi.hoisted(() => ({
  ATLASSIAN_BASE_URL: "https://komainu.atlassian.net",
  ATLASSIAN_EMAIL: "svc@example.com",
  ATLASSIAN_API_TOKEN: "t",
} as Record<string, string | undefined>));
vi.mock("@/lib/env", () => ({ env: (k: string) => envVars[k] }));
vi.mock("@/lib/http/allowed-hosts", () => ({ getAllowedHosts: () => new Set(["komainu.atlassian.net"]) }));

const prismaMock = vi.hoisted(() => ({
  jiraIssueEvent: { findUnique: vi.fn(), create: vi.fn() },
  jiraProjectConfig: { findMany: vi.fn() },
  workItem: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  ticketLink: { upsert: vi.fn() },
  employee: { findFirst: vi.fn(), findUnique: vi.fn() },
  sourceHeartbeat: { findUnique: vi.fn(), upsert: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { CircuitBreaker } from "@/lib/circuit-breaker";
import {
  assertAtlassianPermitted,
  AtlassianForbiddenError,
  updateIssueFields,
} from "@/lib/integrations/atlassian/client";
import { applyIssue, buildJql, stateFromIssue } from "@/modules/integrations/atlassian/sync";
import { assignOwner, changeState, TicketWriteError } from "@/modules/work-items/ticket-writeback";

type Call = { method: string; path: string; body: unknown };
let calls: Call[];
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

beforeEach(() => {
  vi.clearAllMocks();
  CircuitBreaker.resetAll();
});
afterEach(() => vi.unstubAllGlobals());

describe("allowlist", () => {
  it.each([
    ["DELETE", "/rest/api/3/issue/OTC-1"],
    ["PUT", "/rest/api/3/project/OTC"],
    ["POST", "/rest/api/3/workflow"],
    ["PUT", "/rest/api/3/field/customfield_1"],
    ["POST", "/rest/api/3/issue/OTC-1/attachments"],
    ["GET", "/rest/api/3/project"],
  ])("refuses %s %s", (method, path) => {
    expect(() => assertAtlassianPermitted(method, path)).toThrow(AtlassianForbiddenError);
  });

  it.each([
    ["POST", "/rest/api/3/issue"],
    ["POST", "/rest/api/3/issue/OTC-12/comment"],
    ["PUT", "/rest/api/3/issue/OTC-12/assignee"],
    ["POST", "/rest/api/3/issue/OTC-12/transitions"],
    ["POST", "/rest/api/3/issueLink"],
    ["POST", "/rest/servicedeskapi/request"],
  ])("permits %s %s", (method, path) => {
    expect(() => assertAtlassianPermitted(method, path)).not.toThrow();
  });

  it("only sets labels and allowlisted custom fields", async () => {
    stubJira(() => new Response(null, { status: 204 }));
    await expect(updateIssueFields("OTC-1", { summary: "x" }, [])).rejects.toBeInstanceOf(AtlassianForbiddenError);
    await expect(updateIssueFields("OTC-1", { customfield_9: "x" }, ["customfield_1"])).rejects.toBeInstanceOf(AtlassianForbiddenError);
    expect(calls).toHaveLength(0);
    await updateIssueFields("OTC-1", { labels: ["a"], customfield_1: "x" }, ["customfield_1"]);
    expect(calls[0]).toMatchObject({ method: "PUT", path: "/rest/api/3/issue/OTC-1" });
  });
});

describe("inbound sync", () => {
  const issue = (over: Record<string, unknown> = {}) => ({
    id: "1",
    key: "VSR-7",
    fields: {
      summary: "Vendor issue",
      status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
      assignee: { accountId: "acc", emailAddress: "ops@example.com" },
      created: "2026-09-20T09:00:00.000Z",
      updated: "2026-09-23T09:00:00.000Z",
      project: { key: "VSR" },
      ...over,
    },
  });
  const cfg = { kind: "jira", defaultWorkItemKind: "vendor_ticket", defaultTeam: "All", defaultTaskCode: "JIRA-VSR" };

  it("maps status category to state", () => {
    expect(stateFromIssue(issue() as never)).toBe("owned");
    expect(stateFromIssue(issue({ assignee: null }) as never)).toBe("open");
    expect(stateFromIssue(issue({ status: { name: "Done", statusCategory: { key: "done" } } }) as never)).toBe("resolved");
  });

  it("builds a JQL window over enabled projects and drops unsafe keys", () => {
    expect(buildJql(["OTC", "VSR", "x) OR 1=1"])).toBe("project in (OTC, VSR) AND updated >= -5m ORDER BY updated ASC");
  });

  it("creates a WorkItem once per (key, updated) and records history", async () => {
    prismaMock.jiraIssueEvent.findUnique.mockResolvedValueOnce(null);
    prismaMock.workItem.findFirst.mockResolvedValue(null);
    prismaMock.workItem.findUnique.mockResolvedValue(null);
    prismaMock.employee.findFirst.mockResolvedValue({ id: "emp-1" });
    prismaMock.workItem.create.mockResolvedValue({ id: "wi-1" });

    expect(await applyIssue(issue() as never, cfg)).toBe("created");
    const data = prismaMock.workItem.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ kind: "vendor_ticket", sourceSystem: "jira", sourceId: "VSR-7", ticketKey: "VSR-7", state: "owned", ownerEmployeeId: "emp-1" });
    expect(data.clockStartedAt.toISOString()).toBe("2026-09-20T09:00:00.000Z");
    expect(prismaMock.jiraIssueEvent.create).toHaveBeenCalledTimes(1);

    prismaMock.jiraIssueEvent.findUnique.mockResolvedValueOnce({ id: "seen" });
    expect(await applyIssue(issue() as never, cfg)).toBe("skipped");
    expect(prismaMock.workItem.create).toHaveBeenCalledTimes(1);
  });

  it("never reopens a WorkItem closed with a write-up in KOMmand Centre", async () => {
    prismaMock.jiraIssueEvent.findUnique.mockResolvedValue(null);
    prismaMock.workItem.findFirst.mockResolvedValue({ id: "wi-1", state: "closed", title: "t", ownerEmployeeId: null, ownedAt: null, resolvedAt: null, ticketSystem: "jira", ticketKey: "VSR-7", ticketUrl: "u" });
    prismaMock.employee.findFirst.mockResolvedValue(null);
    prismaMock.workItem.update.mockResolvedValue({ id: "wi-1" });
    await applyIssue(issue() as never, cfg);
    expect(prismaMock.workItem.update.mock.calls[0][0].data.state).toBe("closed");
  });
});

describe("write-first", () => {
  const item = { id: "wi-1", ticketKey: "OTC-5", ticketSystem: "jira", state: "open", ownedAt: null, resolvedAt: null };

  it("leaves local state unchanged when Jira rejects the assignment", async () => {
    prismaMock.workItem.findUnique.mockResolvedValue(item);
    prismaMock.employee.findUnique.mockResolvedValue({ email: "ops@example.com" });
    stubJira((c) =>
      c.path.endsWith("/user/search") ? json([{ accountId: "acc", emailAddress: "ops@example.com" }]) : json({ errorMessages: ["no"] }, 403),
    );
    await expect(assignOwner("wi-1", "emp-1")).rejects.toBeInstanceOf(TicketWriteError);
    expect(prismaMock.workItem.update).not.toHaveBeenCalled();
  });

  it("assigns in Jira first, then updates the WorkItem", async () => {
    prismaMock.workItem.findUnique.mockResolvedValue(item);
    prismaMock.employee.findUnique.mockResolvedValue({ email: "ops@example.com" });
    prismaMock.workItem.update.mockResolvedValue({ ...item, ownerEmployeeId: "emp-1", state: "owned" });
    stubJira((c) =>
      c.path.endsWith("/user/search") ? json([{ accountId: "acc", emailAddress: "ops@example.com" }]) : new Response(null, { status: 204 }),
    );
    await assignOwner("wi-1", "emp-1");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /rest/api/3/user/search", "PUT /rest/api/3/issue/OTC-5/assignee"]);
    expect(calls[1].body).toEqual({ accountId: "acc" });
    expect(prismaMock.workItem.update.mock.calls[0][0].data).toMatchObject({ ownerEmployeeId: "emp-1", state: "owned" });
  });

  it("transitions by id looked up at runtime and refuses ambiguity", async () => {
    prismaMock.workItem.findUnique.mockResolvedValue(item);
    prismaMock.workItem.update.mockResolvedValue({ ...item, state: "resolved" });
    const transitions = [
      { id: "31", name: "Resolve", to: { name: "Done", statusCategory: { key: "done" } } },
      { id: "41", name: "Won't do", to: { name: "Closed", statusCategory: { key: "done" } } },
    ];
    stubJira((c) => (c.method === "GET" ? json({ transitions }) : new Response(null, { status: 204 })));

    await expect(changeState("wi-1", "resolved")).rejects.toThrow(/Several transitions/);
    expect(prismaMock.workItem.update).not.toHaveBeenCalled();

    await changeState("wi-1", "resolved", { transitionName: "Resolve" });
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/rest/api/3/issue/OTC-5/transitions", body: { transition: { id: "31" } } });
    expect(prismaMock.workItem.update).toHaveBeenCalledTimes(1);
  });
});
