/**
 * custody API connector (spec §8.1) against a stubbed fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const envVars = vi.hoisted(() => ({} as Record<string, string | undefined>));
vi.mock("@/lib/env", () => ({ env: (k: string) => envVars[k], secret: (k: string) => process.env[k] }));
vi.mock("@/lib/http/allowed-hosts", () => ({ getAllowedHosts: () => new Set(["custody-demo.example.com"]) }));

const prismaMock = vi.hoisted(() => ({
  sourceRecord: { upsert: vi.fn(), updateMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  sourceHeartbeat: { findUnique: vi.fn(), upsert: vi.fn() },
  settlementStatusMap: { findMany: vi.fn() },
  alertRule: { findUnique: vi.fn() },
  alert: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { CircuitBreaker } from "@/lib/circuit-breaker";

const BASE = "https://custody-demo.example.com";
type Call = { url: URL; method: string; auth: string | null; body: string | null };
let calls: Call[];

function stubCustody(routes: (url: URL) => unknown) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(input.toString());
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? "GET", auth: headers.get("authorization"), body: (init?.body as string) ?? null });
    if (url.pathname === "/v1/auth/token") {
      const user = JSON.parse(String(init?.body)).api_user;
      return new Response(JSON.stringify({ access_token: `tok-${user}`, expires_in: 3600 }), { status: 200 });
    }
    return new Response(JSON.stringify(routes(url)), { status: 200 });
  }));
}

async function freshClient() {
  vi.resetModules();
  CircuitBreaker.resetAll();
  return import("@/lib/integrations/custody-api/client");
}

beforeEach(() => {
  for (const k of Object.keys(envVars)) delete envVars[k];
  envVars.CUSTODY_API_BASE_URL = BASE;
  vi.clearAllMocks();
  prismaMock.sourceHeartbeat.findUnique.mockResolvedValue(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CUSTODY_API_SECRET_UK;
  delete process.env.CUSTODY_API_SECRET_JE;
});

describe("credentials (CONFIRM-API-SCOPE)", () => {
  it("parses several users and looks secrets up by reference only", async () => {
    const { parseCredentials } = await freshClient();
    const secrets: Record<string, string> = { CUSTODY_API_SECRET_UK: "s-uk", CUSTODY_API_SECRET_JE: "s-je" };
    const creds = parseCredentials({
      CUSTODY_API_CREDENTIALS: JSON.stringify([
        { label: "uk", user: "u-uk", secretRef: "CUSTODY_API_SECRET_UK" },
        { label: "je", user: "u-je", secretRef: "CUSTODY_API_SECRET_JE" },
      ]),
      lookupSecret: (n) => secrets[n],
    });
    expect(creds).toEqual([
      { label: "uk", user: "u-uk", secret: "s-uk" },
      { label: "je", user: "u-je", secret: "s-je" },
    ]);
  });

  it("refuses secretRefs outside CUSTODY_API_SECRET_* and skips missing secrets", async () => {
    const { parseCredentials } = await freshClient();
    expect(parseCredentials({ CUSTODY_API_CREDENTIALS: JSON.stringify([{ label: "x", user: "u", secretRef: "DATABASE_URL" }]), lookupSecret: () => "leak" })).toEqual([]);
    expect(parseCredentials({ CUSTODY_API_CREDENTIALS: JSON.stringify([{ label: "x", user: "u", secretRef: "CUSTODY_API_SECRET_X" }]), lookupSecret: () => undefined })).toEqual([]);
  });

  it("falls back to the single user/secret pair", async () => {
    const { parseCredentials } = await freshClient();
    expect(parseCredentials({ CUSTODY_API_USER: "u", CUSTODY_API_SECRET: "s", lookupSecret: () => undefined })).toEqual([{ label: "default", user: "u", secret: "s" }]);
  });
});

describe("client", () => {
  it("uses a separate token per API user and follows paging", async () => {
    envVars.CUSTODY_API_CREDENTIALS = JSON.stringify([
      { label: "uk", user: "u-uk", secretRef: "CUSTODY_API_SECRET_UK" },
      { label: "je", user: "u-je", secretRef: "CUSTODY_API_SECRET_JE" },
    ]);
    process.env.CUSTODY_API_SECRET_UK = "s-uk";
    process.env.CUSTODY_API_SECRET_JE = "s-je";
    stubCustody((url) => {
      const page = Number(url.searchParams.get("page"));
      return { page, count: 3, has_next: page < 2, data: [{ id: `r${page}` }] };
    });
    const client = await freshClient();

    const { results } = await client.forEachCredential((cred) => client.fetchAllPages<{ id: string }>("/v1/requests", { status: "PENDING" }, cred));
    expect(results.map((r) => [r.label, r.items.map((i) => i.id)])).toEqual([["uk", ["r1", "r2"]], ["je", ["r1", "r2"]]]);

    const dataCalls = calls.filter((c) => c.url.pathname === "/v1/requests");
    expect(dataCalls.map((c) => c.auth)).toEqual(["Bearer tok-u-uk", "Bearer tok-u-uk", "Bearer tok-u-je", "Bearer tok-u-je"]);
    expect(calls.filter((c) => c.url.pathname === "/v1/auth/token")).toHaveLength(2);
    expect(calls.every((c) => c.method === "GET" || c.url.pathname === "/v1/auth/token")).toBe(true);
  });
});

describe("pollers", () => {
  beforeEach(() => {
    envVars.CUSTODY_API_USER = "u";
    envVars.CUSTODY_API_SECRET = "s";
  });

  it("stores pending requests with only the needed fields and marks vanished ones", async () => {
    stubCustody((url) => url.searchParams.get("status") !== "PENDING" ? { page: 1, count: 0, has_next: false, data: [] } : ({
      page: 1, count: 1, has_next: false,
      data: [{
        id: "req-1", type: "CREATE_TRANSACTION", status: "PENDING", entity: "TRANSACTION", entity_id: "tx-1",
        requested_by: "someone@example.com", requested_at: "2026-09-23T10:00:00Z", expires_at: "2026-09-24T10:00:00Z",
        updated_at: "2026-09-23T10:05:00Z", workspace: "w", organization: "o", account: "a",
      }],
    }));
    await freshClient();
    const { pollRequests } = await import("@/modules/integrations/custody/pollers");

    const result = await pollRequests();
    expect(result.count).toBe(1);

    const upsert = prismaMock.sourceRecord.upsert.mock.calls[0][0];
    expect(upsert.where.source_kind_externalId).toEqual({ source: "custody_api", kind: "request", externalId: "req-1" });
    expect(upsert.create.status).toBe("PENDING");
    expect(upsert.create.fields).not.toHaveProperty("requested_by");

    const vanished = prismaMock.sourceRecord.updateMany.mock.calls[0][0];
    expect(vanished.where).toMatchObject({ kind: "request", status: { in: ["PENDING", "CREATED", "BLOCKED"] }, externalId: { notIn: ["req-1"] } });
    expect(vanished.data).toEqual({ mappedStatus: "no_longer_listed" });
    expect(prismaMock.sourceHeartbeat.upsert.mock.calls[0][0].where.source).toBe("custody_api.requests");
  });

  it("does not keep addresses or hashes from transactions", async () => {
    stubCustody((url) => ({
      page: 1, count: 1, has_next: false,
      data: url.searchParams.get("status") === "PENDING"
        ? [{ id: "tx-1", status: "PENDING", direction: "OUT", asset: "BTC", amount: 1, tx_hash: "0xabc", sender_address: "addr1", receiver_address: "addr2", created_at: "2026-09-23T10:00:00Z" }]
        : [],
    }));
    await freshClient();
    const { pollTransactions } = await import("@/modules/integrations/custody/pollers");
    await pollTransactions();
    const fields = prismaMock.sourceRecord.upsert.mock.calls[0][0].create.fields;
    expect(JSON.stringify(fields)).not.toMatch(/0xabc|addr1|addr2/);
  });

  it("maps settlement statuses; unmapped ones become unknown and raise ALR-CFG-02 only when enabled", async () => {
    stubCustody((url) => ({
      page: 1, count: 1, has_next: false,
      data: url.pathname === "/v1/collateral/settlements" ? [{ id: "s1", status: "DONE", started_at: "2026-09-23T09:00:00Z" }, { id: "s2", status: "WEIRD" }] : [],
    }));
    prismaMock.settlementStatusMap.findMany.mockResolvedValue([{ entity: "settlement", raw: "DONE", mapped: "completed" }]);
    await freshClient();
    const { pollCollateral } = await import("@/modules/integrations/custody/pollers");

    prismaMock.alertRule.findUnique.mockResolvedValue({ code: "ALR-CFG-02", enabled: false, severity: "medium" });
    await pollCollateral();
    const mapped = prismaMock.sourceRecord.upsert.mock.calls.map((c) => [c[0].create.externalId, c[0].create.mappedStatus]);
    expect(mapped).toEqual(expect.arrayContaining([["s1", "completed"], ["s2", "unknown"]]));
    expect(prismaMock.alert.create).not.toHaveBeenCalled();

    prismaMock.alertRule.findUnique.mockResolvedValue({ code: "ALR-CFG-02", enabled: true, severity: "medium" });
    prismaMock.alert.findFirst.mockResolvedValue(null);
    prismaMock.alert.create.mockResolvedValue({ id: "a1" });
    await pollCollateral();
    expect(prismaMock.alert.create.mock.calls[0][0].data).toMatchObject({ ruleCode: "ALR-CFG-02", dedupeKey: "settlement:WEIRD" });
  });
});
