/**
 * Phase 4 acceptance (spec §9.6) plus intake rules, against an in-memory
 * store and a stubbed JSM.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

const envVars = vi.hoisted(() => ({
  ATLASSIAN_BASE_URL: "https://komainu.atlassian.net",
  ATLASSIAN_EMAIL: "svc@example.com",
  ATLASSIAN_API_TOKEN: "t",
} as Record<string, string | undefined>));
vi.mock("@/lib/env", () => ({ env: (k: string) => envVars[k] }));
vi.mock("@/lib/http/allowed-hosts", () => ({ getAllowedHosts: () => new Set(["komainu.atlassian.net"]) }));
vi.mock("@/lib/integrations/slack", () => ({
  getSlackClient: () => ({ chat: { getPermalink: async ({ message_ts }: { message_ts: string }) => ({ permalink: `https://slack.example/p${message_ts}` }) } }),
}));

// ── In-memory store ──
type Row = Record<string, unknown> & { id: string };
const db = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  workItems: [] as Array<Record<string, unknown> & { id: string }>,
  claims: new Map<string, Record<string, unknown>>(),
  clients: new Map<string, Record<string, unknown>>(),
  seq: 0,
}));
const dup = () => new Prisma.PrismaClientKnownRequestError("Unique", { code: "P2002", clientVersion: "5" });
const metaOf = (r: Row) => (r.metadata ?? {}) as Record<string, unknown>;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: { findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (db.settings.has(where.key) ? { key: where.key, value: db.settings.get(where.key) } : null)) },
    sourceRecord: {
      create: vi.fn(async ({ data }: { data: { externalId: string } }) => {
        if (db.claims.has(data.externalId)) throw dup();
        db.claims.set(data.externalId, { ...data });
        return data;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { externalId: string } }) => { db.claims.delete(where.externalId); return { count: 1 }; }),
      update: vi.fn(async ({ where, data }: { where: { source_kind_externalId: { externalId: string } }; data: Record<string, unknown> }) => {
        const id = where.source_kind_externalId.externalId;
        db.claims.set(id, { ...db.claims.get(id), ...data });
      }),
      upsert: vi.fn(),
    },
    workItem: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; sourceSystem_sourceId?: { sourceSystem: string; sourceId: string } } }) =>
        db.workItems.find((w) => (where.id ? w.id === where.id : w.sourceSystem === where.sourceSystem_sourceId!.sourceSystem && w.sourceId === where.sourceSystem_sourceId!.sourceId)) ?? null),
      findFirst: vi.fn(async ({ where }: { where: { sourceSystem: string; metadata: { array_contains: string[] } } }) =>
        db.workItems.find((w) => w.sourceSystem === where.sourceSystem && ((metaOf(w).mergedRootKeys as string[]) ?? []).includes(where.metadata.array_contains[0])) ?? null),
      findMany: vi.fn(async ({ where }: { where: { sourceSystem: string; state: { in: string[] }; AND: Array<{ metadata: { path: string[]; equals: string } }> } }) =>
        db.workItems.filter((w) => w.sourceSystem === where.sourceSystem && where.state.in.includes(w.state as string) &&
          where.AND.every((c) => metaOf(w)[c.metadata.path[0]] === c.metadata.equals))),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `wi-${++db.seq}`, state: "open", firstResponseAt: null, ...data };
        db.workItems.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = db.workItems.find((w) => w.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    slaPolicy: { findUnique: vi.fn(async ({ where }: { where: { code: string } }) => ({ id: `sla-${where.code}` })) },
    ticketLink: { create: vi.fn() },
    commsThread: { findUnique: vi.fn(async () => null), upsert: vi.fn() },
    commsMessage: { upsert: vi.fn() },
    backgroundJob: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: "j" })) },
    client: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => db.clients.get(where.id) ?? null) },
    clientChannel: { findUnique: vi.fn(async () => null) },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth-user", () => ({ requireAuth: vi.fn(async () => ({ id: "u1", name: "L", email: "l@k.com", role: "lead", employeeId: "emp-1", team: null })) }));
vi.mock("@/lib/api/rate-limit-middleware", () => ({ checkRateLimit: () => null, RATE_LIMIT_PRESETS: { mutation: {} } }));

import { CircuitBreaker } from "@/lib/circuit-breaker";
import { handleSlackIntake, classifySlackAuthor } from "@/modules/intake/slack-intake-service";
import { ingestChannelMessage } from "@/modules/slack/services/slack-ingestion-service";
import { handleEmailIntake } from "@/modules/intake/graph-intake-service";
import { derivePriority, summarise } from "@/modules/intake/priority";
import { checkSettingChange } from "@/modules/settings/intake-guards";
import { POST as notAQuestion } from "@/app/api/work-items/[id]/not-a-question/route";

// ── JSM stub ──
type Call = { method: string; path: string; body: Record<string, unknown> | null };
let calls: Call[];
let jsmSeq = 0;
function stubJsm(opts: { failCreate?: boolean } = {}) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(input.toString());
    const c = { method: init?.method ?? "GET", path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(c);
    if (c.path === "/rest/servicedeskapi/request" && c.method === "POST") {
      if (opts.failCreate) return new Response("down", { status: 503 });
      return new Response(JSON.stringify({ issueKey: `CQ-${++jsmSeq}`, issueId: "1" }), { status: 201 });
    }
    if (c.path.endsWith("/transitions") && c.method === "GET") {
      return new Response(JSON.stringify({ transitions: [{ id: "91", name: "Close", to: { name: "Closed", statusCategory: { key: "done" } } }] }));
    }
    return new Response(JSON.stringify({ id: "c1" }), { status: 201 });
  }));
}
const creates = () => calls.filter((c) => c.path === "/rest/servicedeskapi/request" && c.method === "POST");
const comments = () => calls.filter((c) => c.path.endsWith("/comment"));

const KOMAINU_TEAM = "TKOMAINU01";
const CLIENT_TEAM = "TCLIENT001";
const channel = { id: "sc1", channelId: "C0CLIENT001", channelName: "client-acme", purpose: "client", clientId: "cl-1" };
const msg = (ts: string, over: Record<string, unknown> = {}) => ({ ts, user: "UCLIENT01", team: CLIENT_TEAM, text: "Hello, our withdrawal is stuck", ...over });

function configureKommand() {
  db.settings.set("intake.slack.route", "kommand");
  db.settings.set("intake.slack.komainuTeamId", KOMAINU_TEAM);
  db.settings.set("intake.jsm.serviceDeskId", "7");
  db.settings.set("intake.jsm.requestTypeId", "42");
  db.settings.set("intake.jsm.organizationFieldId", "customfield_10002");
}

beforeEach(() => {
  db.settings.clear();
  db.workItems.length = 0;
  db.claims.clear();
  db.clients.clear();
  db.clients.set("cl-1", { id: "cl-1", displayName: "Acme Capital", jsmOrganizationId: "305", isActive: true, channels: [] });
  vi.clearAllMocks();
  CircuitBreaker.resetAll();
  configureKommand();
  jsmSeq = 0;
  stubJsm();
});
afterEach(() => vi.unstubAllGlobals());

describe("spec §9.6 acceptance", () => {
  it("an external root message creates exactly one request, with the correct organisation and a clock equal to the message ts", async () => {
    expect(await handleSlackIntake(channel, msg("1758621600.000100"))).toBe("created");
    expect(await handleSlackIntake(channel, msg("1758621600.000100"))).toBe("duplicate");

    expect(creates()).toHaveLength(1);
    const body = creates()[0].body!;
    expect(body).toMatchObject({ serviceDeskId: "7", requestTypeId: "42" });
    const fields = body.requestFieldValues as Record<string, unknown>;
    expect(fields.customfield_10002).toEqual([305]);
    expect(fields.labels).toEqual(["source-slack", "client-acme-capital"]);
    expect(String(fields.description)).toContain("https://slack.example/p1758621600.000100");

    expect(db.workItems).toHaveLength(1);
    const wi = db.workItems[0];
    expect((wi.clockStartedAt as Date).toISOString()).toBe(new Date(1758621600000.1).toISOString());
    expect(wi).toMatchObject({ kind: "client_request", ticketKey: "CQ-1", clientId: "cl-1", priority: "P1", slaPolicyId: "sla-CLIENT-Q-P1" });
  });

  it("a staff message creates nothing and sets firstResponseAt on the open request", async () => {
    await handleSlackIntake(channel, msg("1758621600.000100"));
    expect(await handleSlackIntake(channel, msg("1758621700.000200", { team: KOMAINU_TEAM, user: "USTAFF01", text: "Looking into it", thread_ts: "1758621600.000100" }))).toBe("first_response");
    expect(await handleSlackIntake(channel, msg("1758621800.000300", { team: KOMAINU_TEAM, user: "USTAFF01", text: "New staff post" }))).toBe("ignored");

    expect(creates()).toHaveLength(1);
    expect((db.workItems[0].firstResponseAt as Date).toISOString()).toBe(new Date(1758621700000.2).toISOString());
    expect(comments().at(-1)!.body).toMatchObject({ public: false });
  });

  it("a thread reply comments on the same request", async () => {
    await handleSlackIntake(channel, msg("1758621600.000100"));
    expect(await handleSlackIntake(channel, msg("1758621650.000150", { text: "Any update?", thread_ts: "1758621600.000100" }))).toBe("commented");
    expect(creates()).toHaveLength(1);
    expect(comments()).toHaveLength(1);
    expect(comments()[0].path).toBe("/rest/servicedeskapi/request/CQ-1/comment");
  });

  it("burst merge works within the window", async () => {
    await handleSlackIntake(channel, msg("1758621600.000100"));
    expect(await handleSlackIntake(channel, msg("1758621690.000200", { text: "Also, tx ref 123" }))).toBe("merged");
    expect(await handleSlackIntake(channel, msg("1758621780.000300", { text: "And one more" }))).toBe("merged"); // 90 s after the previous one
    expect(creates()).toHaveLength(1);
    // A reply in the merged message's thread goes to the same request.
    expect(await handleSlackIntake(channel, msg("1758621800.000400", { text: "reply", thread_ts: "1758621690.000200" }))).toBe("commented");
    // Beyond the window a new request opens.
    expect(await handleSlackIntake(channel, msg("1758622200.000500", { text: "Different question" }))).toBe("created");
    expect(creates()).toHaveLength(2);
  });

  it("a bot message in a client channel creates nothing", async () => {
    expect(await handleSlackIntake(channel, msg("1758621600.000100", { bot_id: "B01", user: undefined }))).toBe("ignored");
    expect(await handleSlackIntake(channel, msg("1758621600.000200", { subtype: "bot_message" }))).toBe("ignored");
    expect(creates()).toHaveLength(0);
  });

  it("a bot message in gx_notifications is passed to the Risk Signal parser", async () => {
    const { prisma } = await import("@/lib/prisma");
    const out = await ingestChannelMessage({ ...channel, purpose: "gx_notifications" }, { ts: "1758621600.1", subtype: "bot_message", bot_id: "B9", text: "Risk: High" });
    expect(out).toBe("risk_signal");
    expect(vi.mocked(prisma.sourceRecord.upsert).mock.calls[0][0].create).toMatchObject({ source: "slack", kind: "risk_signal_raw" });
    expect(creates()).toHaveLength(0);
  });

  it("with jsm_native enabled, the kommand route creates nothing", async () => {
    db.settings.set("intake.slack.route", "jsm_native");
    expect(await handleSlackIntake(channel, msg("1758621600.000100"))).toBe("skipped");
    db.settings.set("intake.slack.route", "off");
    expect(await handleSlackIntake(channel, msg("1758621600.000200"))).toBe("skipped");
    expect(creates()).toHaveLength(0);
    expect(db.workItems).toHaveLength(0);
  });

  it("a 'not a question' close without a reason is rejected (HTTP 422)", async () => {
    await handleSlackIntake(channel, msg("1758621600.000100", { text: "thanks!" }));
    const call = (body: unknown) =>
      notAQuestion(new NextRequest("http://localhost/api/work-items/wi-1/not-a-question", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: db.workItems[0].id }) });

    expect((await call({})).status).toBe(422);
    expect((await call({ reason: "because" })).status).toBe(422);
    expect((await call({ reason: "other" })).status).toBe(422);
    expect(db.workItems[0].state).toBe("open");

    const ok = await call({ reason: "acknowledgement" });
    expect(ok.status).toBe(200);
    expect(db.workItems[0]).toMatchObject({ state: "closed", rootCause: "no_action_required" });
    expect(metaOf(db.workItems[0]).closure).toMatchObject({ nonActionable: true, reason: "acknowledgement" });
    expect(calls.some((c) => c.method === "POST" && c.path === "/rest/api/3/issue/CQ-1/transitions")).toBe(true);
  });
});

describe("intake rules", () => {
  it("only client channels with a linked client are eligible", async () => {
    expect(await handleSlackIntake({ ...channel, clientId: null }, msg("1.1"))).toBe("skipped");
    expect(await handleSlackIntake({ ...channel, purpose: "internal_ops" }, msg("1.2"))).toBe("skipped");
  });

  it("classifies authors: bots, mapped client users, other workspaces, Komainu staff", () => {
    const mapped = new Set(["UMAPPED1"]);
    expect(classifySlackAuthor({ bot_id: "B1" }, KOMAINU_TEAM, mapped)).toBe("bot");
    expect(classifySlackAuthor({ user: "UMAPPED1", team: KOMAINU_TEAM }, KOMAINU_TEAM, mapped)).toBe("external");
    expect(classifySlackAuthor({ user: "U2", team: CLIENT_TEAM }, KOMAINU_TEAM, mapped)).toBe("external");
    expect(classifySlackAuthor({ user: "U3", team: KOMAINU_TEAM }, KOMAINU_TEAM, mapped)).toBe("staff");
    expect(classifySlackAuthor({ user: "U4" }, KOMAINU_TEAM, mapped)).toBe("external"); // over-capture
  });

  it("releases the message when JSM is down, so a retry can create the request", async () => {
    stubJsm({ failCreate: true });
    await expect(handleSlackIntake(channel, msg("1758621600.000100"))).rejects.toThrow();
    expect(db.workItems).toHaveLength(0);
    stubJsm();
    expect(await handleSlackIntake(channel, msg("1758621600.000100"))).toBe("created");
  });

  it("does not open requests while the JSM desk is not configured", async () => {
    db.settings.delete("intake.jsm.requestTypeId");
    expect(await handleSlackIntake(channel, msg("1758621600.000100"))).toBe("not_configured");
    expect(creates()).toHaveLength(0);
    configureKommand();
    expect(await handleSlackIntake(channel, msg("1758621600.000100"))).toBe("created");
  });

  it("applies deterministic priority: P1 on keywords, otherwise P2, never P0", () => {
    const kw = ["urgent", "stuck", "not received", "withdraw"];
    expect(derivePriority("Our deposit was NOT received yet", kw)).toBe("P1");
    expect(derivePriority("Withdraw request pending", kw)).toBe("P1");
    expect(derivePriority("unstuckable", kw)).toBe("P2");
    expect(derivePriority("Thanks, all good", kw)).toBe("P2");
    expect(summarise("a".repeat(200))).toHaveLength(120);
  });

  it("email from an unknown external domain opens a request tagged client-unknown", async () => {
    db.settings.set("intake.email.enabled", true);
    db.settings.set("intake.internalEmailDomains", ["komainu.example"]);
    const out = await handleEmailIntake("custody", {
      id: "m1", internetMessageId: "<m1@x>", conversationId: "conv-1", subject: "Question", bodyPreview: "Where is my deposit?",
      receivedDateTime: "2026-09-23T09:00:00Z", from: { emailAddress: { address: "someone@unknown.example" } },
    }, null);
    expect(out).toBe("created");
    expect((creates()[0].body!.requestFieldValues as Record<string, unknown>).labels).toEqual(["source-email", "client-unknown"]);

    const staff = await handleEmailIntake("custody", {
      id: "m2", internetMessageId: "<m2@x>", conversationId: "conv-1", subject: "RE: Question", bodyPreview: "Checking now",
      receivedDateTime: "2026-09-23T09:10:00Z", from: { emailAddress: { address: "ops@komainu.example" } },
    }, null);
    expect(staff).toBe("first_response");
    expect(creates()).toHaveLength(1);
  });
});

describe("route guards (spec §9.1)", () => {
  it("kommand needs the workspace id and JSM desk; jsm_native needs the verification record", async () => {
    db.settings.clear();
    expect((await checkSettingChange("intake.slack.route", "kommand")).length).toBe(3);
    expect(await checkSettingChange("intake.slack.route", "jsm_native")).toEqual([expect.stringContaining("verification")]);
    db.settings.set("intake.slack.jsmNativeVerification", { completedBy: "A. Person", completedAt: "2026-09-23T10:00:00.000Z", evidenceUrl: "https://example.com/doc" });
    expect(await checkSettingChange("intake.slack.route", "jsm_native")).toEqual([]);
    expect(await checkSettingChange("intake.slack.route", "off")).toEqual([]);
  });
});
