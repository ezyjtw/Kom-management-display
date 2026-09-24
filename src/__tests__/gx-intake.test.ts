/**
 * Spec §16.9 acceptance: sprint intake from release notes and KMNC, impact
 * mapping, idempotent page updates, wallet technology gating, the PROD gate
 * and the release-notes heartbeat.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

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

import { runSprintIntake, runScheduledIntake } from "@/modules/gx-sprints/intake";
import { evaluateReleaseNotesMissing, evaluateUatBeforeProd } from "@/modules/alerting/evaluators/gx";
import { syncRuleCatalogue } from "@/modules/alerting/engine";

const p = () => db.client;
const add = (m: string, data: Record<string, unknown>) => p()[m].create({ data });
const FIXTURE = readFileSync("src/__tests__/fixtures/synthetic/CONFIRM-GX-RELEASE-SAMPLE.md", "utf8");

type Call = { method: string; path: string; body: Record<string, unknown> | null; query: Record<string, string> };
const state = { calls: [] as Call[], page: { version: 1, body: FIXTURE }, n: 0, kmncUpdated: "2026-10-01T09:00:00.000+0000" };

function stub() {
  vi.stubGlobal("fetch", vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(input.toString());
    const c: Call = { method: init?.method ?? "GET", path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null, query: Object.fromEntries(url.searchParams) };
    state.calls.push(c);
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
    if (c.path === "/wiki/rest/api/content/search") return json({ results: [
      { id: "900", title: "[GX-Orchestrate] Sprint 9.99 Release Notes", version: { number: state.page.version }, _links: { webui: "/spaces/AMTK/pages/900" } },
      { id: "901", title: "[GX-Orchestrate] Sprint X.XX Release Notes – Template", version: { number: 4 } },
    ] });
    if (c.path === "/wiki/rest/api/content/900") return json({ id: "900", title: "[GX-Orchestrate] Sprint 9.99 Release Notes", version: { number: state.page.version }, body: { storage: { value: state.page.body } } });
    if (c.path === "/rest/api/3/search/jql") {
      const jql = String(c.body?.jql);
      if (jql.includes("KMNC")) return json({ issues: [
        { key: "KMNC-10", fields: { summary: "GX Sprint 9.99 Upgrade in UAT", updated: state.kmncUpdated, created: "2026-09-30T09:00:00.000+0000", resolutiondate: "2026-10-01T09:00:00.000+0000" } },
        { key: "KMNC-11", fields: { summary: "GX Sprint 9.99 Release in PROD (2026-10-20)", updated: state.kmncUpdated } },
        { key: "KMNC-12", fields: { summary: "GX Sprint 9.98 Upgrade in UAT", updated: state.kmncUpdated } },
      ], isLast: true });
      if (jql.includes("GXS")) return json({ issues: [
        { key: "GXS-500", fields: { summary: "Withdrawal screen rounding", reporter: { accountId: "a1", emailAddress: "ann@k.com" } } },
        { key: "GXS-501", fields: { summary: "Raised by someone else", reporter: { accountId: "a2", emailAddress: "dev@gx.example" } } },
      ], isLast: true });
      return json({ issues: [], isLast: true });
    }
    if (c.method === "POST" && c.path === "/rest/api/3/issue") return json({ id: String(++state.n), key: `TOPS-${state.n}` }, 201);
    if (c.path === "/rest/api/3/user/search") return json([{ accountId: `acc-${c.query.query}`, emailAddress: c.query.query }]);
    if (c.method === "POST" && c.path.endsWith("/comment")) return json({ id: "c" }, 201);
    return new Response(null, { status: 204 });
  }));
}

const created = () => state.calls.filter((c) => c.method === "POST" && c.path === "/rest/api/3/issue").map((c) => c.body!.fields as Record<string, unknown>);
const comments = () => state.calls.filter((c) => c.method === "POST" && c.path.endsWith("/comment"));
const change = async (summaryPart: string) => (await p().gxChange.findMany({})).find((c) => String(c.summary).includes(summaryPart))!;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T08:00:00Z"));
  p().__reset();
  state.calls = [];
  state.page = { version: 1, body: FIXTURE };
  state.n = 0;
  stub();
  await add("jiraProjectConfig", { key: "TOPS", name: "Transaction Operations", enabled: true, issueTypeIds: { _default: "10001", Task: "10001" } });
  await add("employee", { id: "emp-ann", name: "Ann Operator", email: "ann@k.com", role: "Analyst", team: "TransactionOperations", active: true });
  await add("employee", { id: "emp-lee", name: "Lee Lead", email: "lee@k.com", role: "Lead", team: "TransactionOperations", active: true });
  await add("teamConfig", { team: "Team 3", leadEmployeeId: "emp-lee", memberEmployeeIds: ["emp-ann"] });
  for (const r of [
    { name: "Staking", matchOn: "workstream", pattern: "^staking$", taskCodes: ["CHK-16", "CHK-17", "CHK-21", "CHK-22"], controls: ["5.1", "5.2", "5.3"], team: "Team 3", uatTemplate: "UAT-STAKING" },
    { name: "Stake section", matchOn: "section", pattern: "stake\\s*/\\s*unstake", taskCodes: ["CHK-16", "CHK-17", "CHK-21", "CHK-22"], controls: ["5.1", "5.2", "5.3"], team: "Team 3", uatTemplate: "UAT-STAKING" },
    { name: "Risk section", matchOn: "section", pattern: "risk engine", taskCodes: ["TASK-RISKVIEW"], alertCodes: ["ALR-RSK-*"], controls: ["3.2", "3.3"], team: "All", uatTemplate: "UAT-RISK-ENGINE", priority: "P1" },
    { name: "Analytics", matchOn: "keyword", pattern: "analytics\\.|\\brenamed?\\b", taskCodes: ["CHK-02", "CHK-05"], controls: ["4.2"], team: "Team 2", uatTemplate: "UAT-ANALYTICS" },
    { name: "Inactive", matchOn: "keyword", pattern: ".", taskCodes: ["NOPE"], isActive: false },
  ]) await add("gxImpactRule", r);
  await add("uatTemplate", { code: "UAT-STAKING", title: "Staking", steps: "1. Check partner confirmations after an unstake." });
  await add("uatTemplate", { code: "UAT-ANALYTICS", title: "Analytics" });
  await syncRuleCatalogue();
  for (const code of ["ALR-UAT-01", "ALR-UAT-02", "ALR-UAT-04", "ALR-UAT-05", "ALR-HB-GXNOTES"]) await p().alertRule.update({ where: { code }, data: { enabled: true } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("sprint intake", () => {
  it("reads KMNC dates and the release notes, skipping the template page", async () => {
    const res = await runSprintIntake();
    expect(res.sprints).toEqual(["9.99"]);
    const sprint = await p().gxSprint.findUnique({ where: { sprint: "9.99" } });
    expect(sprint).toMatchObject({ pageVersion: 1, releaseNotesPageId: "900", kmncKeys: ["KMNC-10", "KMNC-11"], fixVersions: ["9.99.0-alpha.1", "9.99.0-rc.1"] });
    expect((sprint!.uatLandedAt as Date).toISOString()).toBe("2026-10-01T09:00:00.000Z");
    expect((sprint!.prodPlannedAt as Date).toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(state.calls.some((c) => c.path === "/wiki/rest/api/content/901")).toBe(false);
  });

  it("maps and qualifies items per the section rules and impact mapping", async () => {
    await runSprintIntake();
    const staking = await change("Unstake queue");
    expect(staking).toMatchObject({ itemType: "staking_change", qualifies: true, team: "Team 3", uatTemplate: "UAT-STAKING" });
    expect(staking.affectedTasks).toEqual(expect.arrayContaining(["CHK-16", "CHK-21", "CHK-22"]));
    const analytics = await change("analytics.Account");
    expect(analytics).toMatchObject({ itemType: "deployment_note", qualifies: true });
    expect(analytics.affectedTasks).toContain("CHK-02");
    expect(await change("Restart the notification service")).toMatchObject({ qualifies: false });
    const risk = await change("Auto-approval threshold");
    expect(risk).toMatchObject({ itemType: "risk_engine_change", priority: "P1", qualifies: true });
    expect(await change("Settlement service")).toMatchObject({ itemType: "technical_change", qualifies: true });
    expect(await change("Node runtime")).toMatchObject({ qualifies: false });
    expect(await change("Website copy")).toMatchObject({ itemType: "highlight", qualifies: false });
    expect(await change("Bulk withdrawal limits")).toMatchObject({ tags: ["disabled-in-prod"], qualifies: true });
    expect(await change("statement download")).toMatchObject({ tags: ["client-awareness"], qualifies: true });
    expect((await change("Verify fix GXS-500")).qualifies).toBe(true);
    expect((await p().gxChange.findMany({})).some((c) => String(c.summary).includes("GXS-501"))).toBe(false);
    expect((await change("Withdrawal screen")).affectedTasks).toEqual([]);
  });

  it("wallet technology items are tagged and create no UAT ticket by default", async () => {
    await runSprintIntake();
    const wallet = await change("New wallet technology pilot");
    expect(wallet).toMatchObject({ qualifies: false, tags: ["scoped_not_operational"], workItemId: null });
  });

  it("creates the parent, one child per qualifying item, and follow-ups; content, labels and due date as specified", async () => {
    await runSprintIntake();
    const summaries = created().map((f) => String(f.summary));
    expect(summaries[0]).toBe("GX Sprint 9.99 — Transaction Operations UAT");
    const qualifying = (await p().gxChange.findMany({ where: { qualifies: true } }));
    expect(qualifying.every((c) => c.uatTicketKey)).toBe(true);
    const stakingTicket = created().find((f) => String(f.summary).startsWith("[UAT 9.99] staking_change:"))!;
    expect(stakingTicket.labels).toEqual(expect.arrayContaining(["uat", "gx-sprint-9-99", "staking_change"]));
    expect(stakingTicket.duedate).toBe("2026-10-15"); // PROD 2026-10-20 minus 3 business days
    const text = JSON.stringify(stakingTicket.description);
    expect(text).toContain("Test in GX UAT only");
    expect(text).toContain("Check partner confirmations after an unstake.");
    const analyticsTicket = created().find((f) => String(f.summary).startsWith("[UAT 9.99] deployment_note:"))!;
    expect(JSON.stringify(analyticsTicket.description)).toContain("Test outline not yet written: owner to define.");
    const toggle = created().find((f) => String(f.summary).includes("Bulk withdrawal limits"))!;
    expect(toggle.labels).toContain("disabled-in-prod");
    expect(summaries).toEqual(expect.arrayContaining([
      "[UAT 9.99] Check Komainu API spec version and re-run connector contract tests",
      "[UAT 9.99] Access review: Ops Admin: Split into maker and checker permissions",
      "[UAT 9.99] Review TOP procedure for CHK-16",
      "[UAT 9.99] Review TOP procedure for CHK-02",
    ]));
    // Ops PIC "Ann Operator" is assigned in Jira; GX keys are linked.
    expect(state.calls.some((c) => c.method === "PUT" && c.path.endsWith("/assignee"))).toBe(true);
    expect(state.calls.filter((c) => c.path === "/rest/api/3/issueLink").map((c) => (c.body!.outwardIssue as { key: string }).key)).toEqual(expect.arrayContaining(["GXD-1201", "AMTK-88"]));
    const alerts = await p().alert.findMany({});
    expect(alerts.map((a) => a.ruleCode)).toEqual(expect.arrayContaining(["ALR-UAT-01", "ALR-UAT-05"]));
    expect(alerts.filter((a) => a.ruleCode === "ALR-UAT-05")).toHaveLength(2); // risk engine and permission
  });

  it("re-reading an unchanged page creates nothing", async () => {
    await runSprintIntake();
    const before = { items: (await p().gxChange.findMany({})).length, tickets: created().length };
    await runSprintIntake();
    await runSprintIntake({ force: true });
    expect((await p().gxChange.findMany({})).length).toBe(before.items);
    expect(created().length).toBe(before.tickets);
  });

  it("an edited row updates its ticket with a comment; a removed row is marked removed and never closed", async () => {
    await runSprintIntake();
    const tickets = created().length;
    const staking = await change("Unstake queue");
    const risk = await change("Auto-approval threshold");
    state.page = {
      version: 2,
      body: FIXTURE.replace("Unstake queue now batched hourly", "Unstake queue now batched every 30 minutes").replace("| Auto-approval threshold | Threshold now per asset | AMTK-88 |\n", ""),
    };
    const res = await runSprintIntake();
    expect(res).toMatchObject({ updatedItems: 1, removedItems: 1 });
    expect(created().length).toBe(tickets);
    const edited = (await p().gxChange.findMany({ where: { predecessorId: staking.id } }))[0];
    expect(edited).toMatchObject({ workItemId: staking.workItemId, uatTicketKey: staking.uatTicketKey, removedAt: null });
    const texts = comments().map((c) => JSON.stringify(c.body));
    expect(texts.some((t) => t.includes("Release notes updated (v2)") && t.includes("every 30 minutes"))).toBe(true);
    expect(texts.some((t) => t.includes("no longer in the release notes"))).toBe(true);
    expect((await p().gxChange.findUnique({ where: { id: risk.id } }))!.removedAt).toBeInstanceOf(Date);
    expect((await p().workItem.findUnique({ where: { id: risk.workItemId } }))!.state).not.toBe("closed");
  });
});

describe("alerts", () => {
  it("ALR-UAT-02 fires at PROD minus two business days, not before", async () => {
    await runSprintIntake();
    const ctx = (iso: string) => ({ code: "ALR-UAT-02", now: new Date(iso), params: { businessDaysBeforeProd: 2 } }) as never;
    expect(await evaluateUatBeforeProd(ctx("2026-10-15T12:00:00Z"))).toEqual([]);
    const hits = await evaluateUatBeforeProd(ctx("2026-10-16T08:00:00Z")); // Friday before Tuesday 20th
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ dedupeKey: "9.99", severity: "high" });
    for (const c of await p().gxChange.findMany({ where: { qualifies: true } })) await p().gxChange.update({ where: { id: c.id }, data: { uatOutcome: "pass" } });
    expect(await evaluateUatBeforeProd(ctx("2026-10-16T08:00:00Z"))).toEqual([]);
  });

  it("ALR-HB-GXNOTES: a KMNC sprint with no release notes after a day", async () => {
    await runSprintIntake();
    const ctx = (iso: string) => ({ code: "ALR-HB-GXNOTES", now: new Date(iso), params: { graceHours: 24 } }) as never;
    expect(await evaluateReleaseNotesMissing(ctx("2026-10-02T12:00:00Z"))).toEqual([]);
    const hits = await evaluateReleaseNotesMissing(ctx("2026-10-04T12:00:00Z"));
    expect(hits.map((h) => h.dedupeKey)).toEqual(["9.98"]);
  });

  it("ALR-UAT-04: release notes changed after every item had an outcome", async () => {
    await runSprintIntake();
    for (const c of await p().gxChange.findMany({ where: { qualifies: true } })) await p().gxChange.update({ where: { id: c.id }, data: { uatOutcome: "pass" } });
    state.page = { version: 2, body: FIXTURE.replace("| ETH | Unstake queue now batched hourly", "| SOL | New unstake flow | x |\n| ETH | Unstake queue now batched hourly") };
    await runSprintIntake();
    expect((await p().alert.findMany({ where: { ruleCode: "ALR-UAT-04" } }))).toHaveLength(1);
  });
});

describe("schedule", () => {
  it("the hourly job runs the full intake on the configured schedule or when KMNC changes", async () => {
    expect((await runScheduledIntake(new Date("2026-10-02T08:00:00Z"))).trigger).toBe("schedule");
    expect((await runScheduledIntake(new Date("2026-10-02T09:00:00Z"))).ran).toBe(true); // first KMNC check records the cursor
    expect((await runScheduledIntake(new Date("2026-10-02T10:00:00Z"))).ran).toBe(false);
    state.kmncUpdated = "2026-10-02T10:30:00.000+0000";
    expect((await runScheduledIntake(new Date("2026-10-02T11:00:00Z"))).trigger).toBe("kmnc");
    expect((await runScheduledIntake(new Date("2026-10-03T07:05:00Z"))).trigger).toBe("schedule");
  });
});

describe("no false green in the intake summary", () => {
  it("counts only tickets Jira accepted; failures are reported separately", async () => {
    await p().jiraProjectConfig.update({ where: { key: "TOPS" }, data: { enabled: false } });
    const res = await runSprintIntake();
    expect(res.ticketsCreated).toBe(0);
    expect(res.ticketsFailed).toBeGreaterThan(0);
  });
});
