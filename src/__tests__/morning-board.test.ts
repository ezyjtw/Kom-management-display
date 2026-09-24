/**
 * Phase 9 (spec §14.1, §14.3, §14.4): morning board and lead handover, the
 * first-response quick action, navigation and desktop notifications.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof import("@/__tests__/helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", async () => {
  const { createFakePrisma } = await import("@/__tests__/helpers/fake-prisma");
  db.client = createFakePrisma();
  return { prisma: db.client };
});
const envVars = vi.hoisted(() => ({ ATLASSIAN_BASE_URL: "https://example.atlassian.net", ATLASSIAN_EMAIL: "svc@example.com", ATLASSIAN_API_TOKEN: "t", NEXTAUTH_URL: "https://k.example" } as Record<string, string | undefined>));
vi.mock("@/lib/env", () => ({ env: (k: string) => envVars[k] }));
vi.mock("@/lib/http/allowed-hosts", () => ({ getAllowedHosts: () => new Set(["example.atlassian.net"]) }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: vi.fn(async () => false) }));
vi.mock("@/lib/sse", () => ({ emitWorkItemUpdate: () => undefined }));
const out = vi.hoisted(() => ({ slack: [] as Array<{ channel: string; thread_ts?: string; text: string }>, emails: [] as string[] }));
vi.mock("@/lib/integrations/slack", () => ({
  getSlackClient: () => ({
    chat: { postMessage: async (m: { channel: string; thread_ts?: string; text: string }) => { out.slack.push(m); return { ok: true }; } },
    users: { lookupByEmail: async ({ email }: { email: string }) => ({ user: { id: `U-${email.split("@")[0]}` } }) },
  }),
}));
vi.mock("@/lib/integrations/email", () => ({ sendEmailNotification: async (to: string) => { out.emails.push(to); return true; } }));
const auth = vi.hoisted(() => ({ user: { id: "u-lee", name: "Lee", email: "lee@k.com", role: "lead", employeeId: "emp-lee", team: null } as Record<string, unknown> }));
vi.mock("@/lib/auth-user", () => ({ requireAuth: vi.fn(async () => auth.user) }));
vi.mock("@/lib/api/rate-limit-middleware", () => ({ checkRateLimit: () => null, RATE_LIMIT_PRESETS: { mutation: {}, read: {} } }));

import { GET as morningGet } from "@/app/api/morning/route";
import { POST as handoverPost } from "@/app/api/morning/handover/route";
import { POST as absencePost } from "@/app/api/morning/absence/route";
import { POST as retryPost } from "@/app/api/morning/handover/retry/route";
import { POST as firstResponse } from "@/app/api/work-items/[id]/first-response/route";
import { runMorningHandover } from "@/modules/morning/handover";
import { previousBusinessDate } from "@/modules/morning/board";
import { desktopNotificationFor } from "@/components/shared/DesktopAlerts";

const p = () => db.client;
const add = (m: string, data: Record<string, unknown>) => p()[m].create({ data });
const req = (url: string, method = "GET", body?: unknown) => new NextRequest(`http://localhost${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

type Call = { method: string; path: string; body: Record<string, unknown> | null };
const jira = { calls: [] as Call[], failPaths: new Set<string>() };
const comments = () => jira.calls.filter((c) => c.method === "POST" && c.path.endsWith("/comment"));

// Wednesday 23 Sep 2026, 08:30 London (07:30 UTC).
const NOW = new Date("2026-09-23T07:30:00Z");
const ago = (mins: number) => new Date(NOW.getTime() - mins * 60_000);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  p().__reset();
  jira.calls = [];
  jira.failPaths = new Set();
  out.slack = [];
  out.emails = [];
  auth.user = { id: "u-lee", name: "Lee", email: "lee@k.com", role: "lead", employeeId: "emp-lee", team: null };
  vi.stubGlobal("fetch", vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(input.toString());
    jira.calls.push({ method: init?.method ?? "GET", path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (jira.failPaths.has(url.pathname)) return new Response(JSON.stringify({ errorMessages: ["unavailable"] }), { status: 503 });
    if ((init?.method ?? "GET") === "POST" && url.pathname.endsWith("/comment")) return new Response(JSON.stringify({ id: "c" }), { status: 201 });
    return new Response(null, { status: 204 });
  }));

  for (const [id, name, email] of [["emp-lee", "Lee Lead", "lee@k.com"], ["emp-ann", "Ann Operator", "ann@k.com"], ["emp-bob", "Bob Operator", "bob@k.com"]]) {
    await add("employee", { id, name, email, role: "Analyst", team: "TransactionOperations", active: true });
  }
  await add("user", { id: "u-lee", email: "lee@k.com", name: "Lee", role: "lead", employeeId: "emp-lee" });
  await add("user", { id: "u-head", email: "head@k.com", name: "Head", role: "admin", employeeId: null });
  await add("user", { id: "u-ann", email: "ann@k.com", name: "Ann", role: "employee", employeeId: "emp-ann" });
  await add("teamConfig", { team: "Team 2", leadEmployeeId: "emp-lee", deputyEmployeeId: "emp-bob", memberEmployeeIds: ["emp-ann"] });

  const w = { team: "Team 2", taskCode: "T", sourceSystem: "kommand", ticketSystem: "jira" };
  await add("workItem", { ...w, id: "wi-exc", kind: "daily_check_exception", title: "CHK-01 stuck tx", sourceId: "1", ticketKey: "OPS-1", clockStartedAt: ago(1500), ownerEmployeeId: "emp-lee", state: "owned" });
  await add("workItem", { ...w, id: "wi-wait", kind: "client_request", title: "Address check", sourceId: "2", ticketKey: "OPS-2", clockStartedAt: ago(300), state: "waiting_client", ownerEmployeeId: "emp-lee", metadata: { waitingReason: "Client to confirm address", waitingSince: ago(120).toISOString() } });
  await add("workItem", { ...w, id: "wi-verbal", kind: "internal_task", title: "Verbal-only item", sourceId: "3", clockStartedAt: ago(60) });
  await add("workItem", { ...w, id: "wi-oes", kind: "oes_settlement", title: "OES window 08:00", sourceId: "4", ticketKey: "OPS-4", clockStartedAt: ago(30) });
  await add("slaEvent", { workItemId: "wi-wait", kind: "first_response_breach", at: ago(200) });
  await add("slaEvent", { workItemId: "wi-wait", kind: "resolution_breach", at: ago(2000) });
  await add("alert", { type: "ALR-OES-01", ruleCode: "ALR-OES-01", dedupeKey: "d", message: "OES window late", severity: "critical", workItemId: "wi-oes" });
  await add("alert", { type: "ALR-X", ruleCode: "ALR-X", dedupeKey: "e", message: "No ticket alert", severity: "high" });
  await add("dailyCheckDefinition", { code: "CHK-01", name: "Stuck Transactions", team: "Team 2", frequency: "daily", dueByLocal: "09:05", evidenceSpec: {}, ticketProject: "OPS", confluenceUrl: "x" });
  await add("dailyCheckItem", { runId: "r", name: "Stuck Transactions", category: "CHK-01", definitionCode: "CHK-01", periodKey: "2026-09-22", status: "pending" });
  await add("dailyCheckItem", { runId: "r", name: "Stuck Transactions", category: "CHK-01", definitionCode: "CHK-01", periodKey: "2026-09-21", status: "pending" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function board() {
  const res = await morningGet(req("/api/morning"));
  expect(res.status).toBe(200);
  return (await res.json()).data;
}

describe("morning board (spec §14.3)", () => {
  it("is built only from ticketed WorkItems, with the no-verbal-updates banner", async () => {
    const b = await board();
    expect(b.banner).toMatch(/No verbal-only updates/);
    const t2 = b.teams.find((t: { team: string }) => t.team === "Team 2");
    expect(JSON.stringify(t2)).not.toContain("Verbal-only item");
    expect(t2.checksNotCompleted).toEqual([{ code: "CHK-01", name: "Stuck Transactions", periodKey: "2026-09-22", status: "pending" }]);
    expect(t2.openExceptions).toEqual([expect.objectContaining({ id: "wi-exc", ticketKey: "OPS-1", ageMins: 1500 })]);
    expect(t2.blockers).toEqual([expect.objectContaining({ id: "wi-wait", state: "waiting_client", reason: "Client to confirm address", sinceMins: 120 })]);
    expect(t2.slaBreaches24h).toEqual([expect.objectContaining({ id: "wi-wait", breach: "first response" })]);
    expect(t2.activeAlerts).toEqual([expect.objectContaining({ ruleCode: "ALR-OES-01", ticketKey: "OPS-4" })]);
    expect(t2.oes.open).toBe(1);
    expect(t2.lead).toEqual({ id: "emp-lee", name: "Lee Lead" });
  });

  it("looks back to the previous business day (Friday on a Monday)", () => {
    const cal = { is24x7: false, startMin: 480, endMin: 1080, holidays: new Set<string>() };
    expect(previousBusinessDate(cal, "2026-09-28")).toBe("2026-09-25");
    expect(previousBusinessDate({ ...cal, holidays: new Set(["2026-09-25"]) }, "2026-09-28")).toBe("2026-09-24");
  });
});

describe("lead handover (spec §14.3)", () => {
  it("an absent lead picks a covering member and a note, which posts to each of the lead's open tickets", async () => {
    expect((await absencePost(req("/x", "POST", { date: "2026-09-23", team: "Team 2", absent: true }))).status).toBe(200);
    expect((await board()).teams.find((t: { team: string }) => t.team === "Team 2").handover).toMatchObject({ absent: true, source: "manual", missing: false });

    expect((await handoverPost(req("/x", "POST", { date: "2026-09-23", team: "Team 2", coveringEmployeeId: "emp-lee", note: "All tickets are in hand; see comments." }))).status).toBe(422);
    const res = await handoverPost(req("/x", "POST", { date: "2026-09-23", team: "Team 2", coveringEmployeeId: "emp-ann", note: "OPS-1 waits on the vendor; OPS-2 waits on the client." }));
    expect(res.status).toBe(200);
    expect(comments().map((c) => c.path).sort()).toEqual(["/rest/api/3/issue/OPS-1/comment", "/rest/api/3/issue/OPS-2/comment"]);
    expect(JSON.stringify(comments()[0].body)).toContain("Covering: Ann Operator");
    const h = (await board()).teams.find((t: { team: string }) => t.team === "Team 2").handover;
    expect(h).toMatchObject({ absent: true, covering: { name: "Ann Operator" }, postedTo: 2, late: false });
    // The rejected attempt (lead as cover) is on record as requested + failed, then the accepted one as requested + completed.
    expect((await p().auditLog.findMany({ where: { action: "lead_handover_submitted" } })).map((a) => a.phase)).toEqual(["requested", "failed", "requested", "completed"]);
  });

  it("only the team's lead, deputy or an admin can write it", async () => {
    auth.user = { id: "u-ann", name: "Ann", email: "ann@k.com", role: "employee", employeeId: "emp-ann", team: null };
    expect((await handoverPost(req("/x", "POST", { date: "2026-09-23", team: "Team 2", coveringEmployeeId: "emp-bob", note: "Everything is on the tickets already." }))).status).toBe(403);
  });

  it("a PTO absence with no note by 09:00 notifies the lead and the head of operations, once", async () => {
    await add("ptoRecord", { employeeId: "emp-lee", startDate: new Date("2026-09-23T00:00:00Z"), endDate: new Date("2026-09-25T00:00:00Z"), type: "annual_leave", status: "approved" });
    vi.setSystemTime(new Date("2026-09-23T08:00:00Z")); // 09:00 London
    expect(await runMorningHandover()).toEqual({ posted: 0, incomplete: 0, missing: 1 });
    const notes = await p().inAppNotification.findMany({});
    expect(notes.map((n) => String(n.userId)).sort()).toEqual(["u-head", "u-lee"]);
    expect(out.emails.sort()).toEqual(["head@k.com", "lee@k.com"]);
    expect(await runMorningHandover()).toEqual({ posted: 0, incomplete: 0, missing: 1 });
    expect(await p().inAppNotification.findMany({})).toHaveLength(2); // not re-sent
    expect((await board()).teams.find((t: { team: string }) => t.team === "Team 2").handover).toMatchObject({ absent: true, source: "pto", missing: true });
  });

  it("a handover written in advance posts at 09:00 on the day; weekends are skipped", async () => {
    await add("ptoRecord", { employeeId: "emp-lee", startDate: new Date("2026-09-24T00:00:00Z"), endDate: new Date("2026-09-24T00:00:00Z"), type: "annual_leave", status: "approved" });
    expect((await handoverPost(req("/x", "POST", { date: "2026-09-24", team: "Team 2", coveringEmployeeId: "emp-bob", note: "Bob covers; OPS-1 needs a vendor chase." }))).status).toBe(200);
    expect(comments()).toHaveLength(0);
    vi.setSystemTime(new Date("2026-09-24T08:00:00Z"));
    expect(await runMorningHandover()).toEqual({ posted: 1, incomplete: 0, missing: 0 });
    expect(comments()).toHaveLength(2);
    vi.setSystemTime(new Date("2026-09-26T08:00:00Z"));
    expect((await runMorningHandover()).skipped).toBe("not a business day");
  });
});

describe("no false green (review remediation)", () => {
  const team2 = async () => (await board()).teams.find((t: { team: string }) => t.team === "Team 2");

  it("a failed ticket comment leaves the handover partially posted, and a retry posts only the failed ticket", async () => {
    jira.failPaths.add("/rest/api/3/issue/OPS-2/comment");
    await absencePost(req("/x", "POST", { date: "2026-09-23", team: "Team 2", absent: true }));
    expect((await handoverPost(req("/x", "POST", { date: "2026-09-23", team: "Team 2", coveringEmployeeId: "emp-ann", note: "OPS-1 waits on the vendor; OPS-2 waits on the client." }))).status).toBe(200);
    let h = (await team2()).handover;
    expect(h).toMatchObject({ postStatus: "partially_posted", postedAt: null, postedTo: 1, failedTickets: ["OPS-2"] });

    // Saving again is refused: retry the failed ticket instead.
    expect((await handoverPost(req("/x", "POST", { date: "2026-09-23", team: "Team 2", coveringEmployeeId: "emp-ann", note: "A different note for the same day." }))).status).toBe(409);

    jira.failPaths.clear();
    const before = comments().length;
    expect((await retryPost(req("/x", "POST", { date: "2026-09-23", team: "Team 2" }))).status).toBe(200);
    expect(comments().slice(before).map((c) => c.path)).toEqual(["/rest/api/3/issue/OPS-2/comment"]);
    h = (await team2()).handover;
    expect(h).toMatchObject({ postStatus: "posted", postedTo: 2, failedTickets: [] });
    expect(h.postedAt).not.toBeNull();
  });

  it("when every comment fails the handover is 'failed', and the 09:00 job retries it", async () => {
    jira.failPaths.add("/rest/api/3/issue/OPS-1/comment");
    jira.failPaths.add("/rest/api/3/issue/OPS-2/comment");
    await absencePost(req("/x", "POST", { date: "2026-09-23", team: "Team 2", absent: true }));
    await handoverPost(req("/x", "POST", { date: "2026-09-23", team: "Team 2", coveringEmployeeId: "emp-bob", note: "Everything is waiting on third parties today." }));
    expect((await team2()).handover).toMatchObject({ postStatus: "failed", postedTo: 0 });
    vi.setSystemTime(new Date("2026-09-23T08:15:00Z"));
    expect(await runMorningHandover()).toEqual({ posted: 0, incomplete: 1, missing: 0 });
    jira.failPaths.clear();
    vi.setSystemTime(new Date("2026-09-23T08:30:00Z"));
    expect(await runMorningHandover()).toEqual({ posted: 1, incomplete: 0, missing: 0 });
  });

  it("cover must be the deputy or a team member who is active and not on leave", async () => {
    await add("employee", { id: "emp-zed", name: "Zed Elsewhere", email: "zed@k.com", role: "Analyst", team: "DataOperations", active: true });
    await add("ptoRecord", { employeeId: "emp-ann", startDate: new Date("2026-09-23T00:00:00Z"), endDate: new Date("2026-09-23T00:00:00Z") });
    const body = (coveringEmployeeId: string) => ({ date: "2026-09-23", team: "Team 2", coveringEmployeeId, note: "Cover the queue and chase OPS-1 with the vendor." });
    expect((await handoverPost(req("/x", "POST", body("emp-zed")))).status).toBe(422);
    expect((await handoverPost(req("/x", "POST", body("emp-ann")))).status).toBe(422); // on leave
    expect((await team2()).coverPool).toEqual([{ id: "emp-bob", name: "Bob Operator" }]);
    expect((await handoverPost(req("/x", "POST", body("emp-bob")))).status).toBe(200);
  });

  it("reminders record per-channel evidence; a recipient counts as reached only when a channel accepted it", async () => {
    await add("ptoRecord", { employeeId: "emp-lee", startDate: new Date("2026-09-23T00:00:00Z"), endDate: new Date("2026-09-23T00:00:00Z") });
    vi.setSystemTime(new Date("2026-09-23T08:00:00Z"));
    await runMorningHandover();
    const row = await p().leadHandover.findUnique({ where: { date_team: { date: "2026-09-23", team: "Team 2" } } });
    expect(row!.reminderResults).toEqual(expect.arrayContaining([expect.objectContaining({ userId: "u-lee", inApp: true, slack: true, email: true })]));
    expect(row!.missingNotifiedAt).toBeInstanceOf(Date);
    expect((await team2()).handover.reminder).toMatchObject({ reached: 2, recipients: 2 });
  });

  it("with no one to reach, the reminder is not marked done and the next run tries again", async () => {
    await p().user.deleteMany({});
    await add("ptoRecord", { employeeId: "emp-lee", startDate: new Date("2026-09-23T00:00:00Z"), endDate: new Date("2026-09-23T00:00:00Z") });
    vi.setSystemTime(new Date("2026-09-23T08:00:00Z"));
    await runMorningHandover();
    const row = await p().leadHandover.findUnique({ where: { date_team: { date: "2026-09-23", team: "Team 2" } } });
    expect(row!.missingNotifiedAt ?? null).toBeNull();
  });

  it("the board tells the page which teams this user may manage", async () => {
    expect((await board()).me.canManage).toEqual(["Team 2"]);
    auth.user = { id: "u-ann", name: "Ann", email: "ann@k.com", role: "employee", employeeId: "emp-ann", team: null };
    expect((await board()).me.canManage).toEqual([]);
  });

  it("the sidebar shows admin-only items to admins only (the /admin middleware rule)", () => {
    const sidebar = readFileSync("src/components/shared/Sidebar.tsx", "utf8");
    expect(sidebar).toContain('const isAdmin = user?.role === "admin";');
    expect(sidebar).not.toMatch(/isAdmin = [^;]*"lead"/);
    expect(sidebar).toContain('href: "/alerts"');
  });
});

describe("first response quick action (spec §14.4)", () => {
  beforeEach(async () => {
    await add("client", { id: "cl-1", displayName: "Acme Capital", isActive: true });
    await add("client", { id: "cl-2", displayName: "Globex Partners", isActive: true });
    await add("workItem", { id: "cr-slack", kind: "client_request", title: "Withdrawal", team: "Team 2", taskCode: "CLIENT-Q", sourceSystem: "slack", sourceId: "C0123456:1695460000.000100", clientId: "cl-1", ticketKey: "OPS-9", clockStartedAt: ago(10) });
    await add("workItem", { id: "cr-mail", kind: "client_request", title: "Email", team: "Team 2", taskCode: "CLIENT-Q", sourceSystem: "email", sourceId: "conv-1", clientId: "cl-1", ticketKey: "OPS-10", clockStartedAt: ago(10) });
    await add("sourceRecord", { source: "graph_mail", kind: "mail_message", externalId: "m1", occurredAt: ago(10), fields: { mailbox: "custody", from: "ops@acme.example", message: { id: "graph-msg-1", conversationId: "conv-1" } } });
  });

  it("replies in the client's Slack thread, written by the operator, and stops the first-response clock", async () => {
    const res = await firstResponse(req("/x", "POST", { body: "Thanks, we are looking into it. Reference OPS-9." }), { params: Promise.resolve({ id: "cr-slack" }) });
    expect(res.status).toBe(200);
    expect(out.slack).toEqual([{ channel: "C0123456", thread_ts: "1695460000.000100", text: "Thanks, we are looking into it. Reference OPS-9." }]);
    expect((await p().workItem.findUnique({ where: { id: "cr-slack" } }))!.firstResponseAt).toBeInstanceOf(Date);
    expect(await p().outboundMessageDraft.findMany({ where: { purpose: "first_response", status: "sent" } })).toHaveLength(1);
  });

  it("blocks a reply naming another client (H12)", async () => {
    const res = await firstResponse(req("/x", "POST", { body: "Same issue as Globex Partners had yesterday." }), { params: Promise.resolve({ id: "cr-slack" }) });
    expect(res.status).toBe(422);
    expect(out.slack).toHaveLength(0);
    expect((await p().workItem.findUnique({ where: { id: "cr-slack" } }))!.firstResponseAt ?? null).toBeNull();
  });

  it("email replies need Graph sending enabled; otherwise the operator sends from Outlook and marks it sent", async () => {
    const ctx = { params: Promise.resolve({ id: "cr-mail" }) };
    expect((await firstResponse(req("/x", "POST", { body: "Thanks, we are on it." }), ctx)).status).toBe(409);
    expect((await firstResponse(req("/x", "POST", { body: "Thanks, we are on it.", markSentManually: true }), { params: Promise.resolve({ id: "cr-mail" }) })).status).toBe(200);
    expect((await p().workItem.findUnique({ where: { id: "cr-mail" } }))!.firstResponseAt).toBeInstanceOf(Date);
  });
});

describe("navigation (spec §14.1) and desktop notifications (spec §14.4)", () => {
  const sidebar = readFileSync("src/components/shared/Sidebar.tsx", "utf8");

  it("lists the spec's destinations and none of the removed ones", () => {
    for (const href of ["/work", "/boards", "/daily-checks", "/alerts", "/clients/overview", "/settlements", "/travel-rule", "/staking", "/realisations", "/bank", "/tokens", "/incidents", "/rca", "/metrics", "/morning", "/admin"]) {
      expect(sidebar).toContain(`href: "${href}"`);
    }
    for (const href of ["/approvals", "/usdc-ramp", "/briefing", "/compliance-bot", "/activity"]) expect(sidebar).not.toContain(`href: "${href}"`);
    expect(sidebar).toMatch(/href: "\/realisations".*capability: "realisations"/);
    expect(sidebar).toMatch(/href: "\/bank".*flag: "module\.bank"/);
  });

  it("notifies only for new P1 client requests and critical alerts", () => {
    expect(desktopNotificationFor({ type: "work_item_update", data: { change: "created", kind: "client_request", priority: "P1", workItemId: "w1" } })).toMatchObject({ link: "/work/w1" });
    expect(desktopNotificationFor({ type: "work_item_update", data: { change: "created", kind: "client_request", priority: "P2", workItemId: "w1" } })).toBeNull();
    expect(desktopNotificationFor({ type: "work_item_update", data: { change: "owner", kind: "client_request", priority: "P1", workItemId: "w1" } })).toBeNull();
    expect(desktopNotificationFor({ type: "alert", data: { severity: "critical", type: "ALR-OES-01", message: "late", alertId: "a" } })).toMatchObject({ title: "Critical alert ALR-OES-01" });
    expect(desktopNotificationFor({ type: "alert", data: { severity: "high" } })).toBeNull();
  });
});
