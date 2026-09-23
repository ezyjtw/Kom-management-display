/**
 * Spec §12 framework: item generation per frequency, automated data pulls,
 * team boards, the approved-validator banner and restricted KPS checks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const db = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof import("@/__tests__/helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", async () => {
  const { createFakePrisma } = await import("@/__tests__/helpers/fake-prisma");
  db.client = createFakePrisma();
  return { prisma: db.client };
});
const flags = vi.hoisted(() => ({ on: new Set<string>() }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: vi.fn(async (k: string) => flags.on.has(k)) }));

import { generateDailyItems, isoWeekKey, syncDailyCheckDefinitions } from "@/modules/daily-checks/schedule";
import { collectForItem, redactRef } from "@/modules/daily-checks/collectors";
import { APPROVED_VALIDATORS_MISSING, buildBoard } from "@/modules/daily-checks/board";
import { passItem } from "@/modules/daily-checks/enforcement";
import { canViewKps } from "@/modules/kps/access";

const p = () => db.client;
const WED = new Date("2026-09-23T08:00:00Z"); // Wednesday 09:00 London
const MON = new Date("2026-09-21T08:00:00Z");
const SAT = new Date("2026-09-26T08:00:00Z");
const mins = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
const add = (model: string, data: Record<string, unknown>) => p()[model].create({ data });

async function items(code: string) {
  return p().dailyCheckItem.findMany({ where: { definitionCode: code } });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(WED);
  p().__reset();
  flags.on.clear();
});
afterEach(() => vi.useRealTimers());

describe("item generation", () => {
  it("creates daily items on business days only, idempotently", async () => {
    await generateDailyItems(WED);
    expect((await items("CHK-01")).map((i) => i.periodKey)).toEqual(["2026-09-23"]);
    const again = await generateDailyItems(WED);
    expect(again.created).toBe(0);

    p().__reset();
    await generateDailyItems(SAT);
    expect(await items("CHK-01")).toHaveLength(0);
  });

  it("skips public holidays", async () => {
    await add("publicHoliday", { date: new Date("2026-09-23T00:00:00Z"), name: "Test", region: "Global" });
    await generateDailyItems(WED);
    expect(await items("CHK-01")).toHaveLength(0);
  });

  it("creates weekly items on their weekday with an ISO week key", async () => {
    await generateDailyItems(WED);
    expect(await items("CHK-08")).toHaveLength(0);
    await generateDailyItems(MON);
    expect((await items("CHK-08")).map((i) => i.periodKey)).toEqual([isoWeekKey("2026-09-21")]);
    expect(isoWeekKey("2026-09-21")).toBe("2026-W39");
  });

  it("creates one CHK-10 item per settlement window that has started today", async () => {
    await add("oesWindow", { exchange: "okx", cron: "0 9 * * *", durationMins: 30, referenceTz: "UTC", isActive: true });
    await add("oesWindow", { exchange: "bybit", cron: "0 */6 * * *", durationMins: 30, referenceTz: "UTC", isActive: true });
    await generateDailyItems(new Date("2026-09-23T09:10:00Z"));
    expect((await items("CHK-10")).map((i) => i.periodKey).sort()).toEqual([
      "2026-09-23:bybit:00:00Z", "2026-09-23:bybit:06:00Z", "2026-09-23:okx:09:00Z",
    ]);
  });

  it("creates no FAB items while module.fab is off", async () => {
    await generateDailyItems(WED);
    expect(await items("TASK-FAB-REPORT")).toHaveLength(0);
    flags.on.add("module.fab");
    await generateDailyItems(WED);
    expect(await items("TASK-FAB-REPORT")).toHaveLength(1);
  });

  it("creates no items for event and continuous tasks", async () => {
    await generateDailyItems(WED);
    for (const code of ["TASK-CLIENTQ", "TASK-VENDOR", "TASK-BILL", "TASK-RISKVIEW"]) expect(await items(code)).toHaveLength(0);
  });
});

describe("automated data pulls", () => {
  async function item(code: string, periodKey = "2026-09-23") {
    await syncDailyCheckDefinitions();
    return add("dailyCheckItem", { runId: "r", name: code, category: code, definitionCode: code, periodKey });
  }

  it("CHK-01 proposes one exception per stuck transaction and suppresses known-degraded assets with the reason", async () => {
    await add("sourceHeartbeat", { source: "komainu_api.transactions", expectedEveryMins: 2, lastSuccessAt: mins(WED, -1), lastCount: 3 });
    await add("assetThreshold", { asset: "*", stuckMins: 120 });
    await add("assetStatus", { asset: "XTZ", status: "known_degraded", reason: "Chain halted, vendor aware" });
    const tx = (id: string, asset: string, age: number) => add("sourceRecord", { source: "komainu_api", kind: "transaction", externalId: id, status: "PENDING", occurredAt: mins(WED, -age), fields: { asset } });
    await tx("11111111-2222-3333-4444-555555555555", "BTC", 200);
    await tx("22222222-2222-3333-4444-555555555555", "XTZ", 300);
    await tx("33333333-2222-3333-4444-555555555555", "ETH", 10);
    const it = await item("CHK-01");

    const result = await collectForItem(it.id as string, WED);
    expect(result).toMatchObject({ available: true, recordCount: 3, fields: { stuckCount: 2, suppressedCount: 1 } });
    expect(result!.exceptions).toEqual([{ summary: "BTC PENDING for 200 min (limit 120)", reference: "1111…5555" }]);
    expect(result!.suppressed).toEqual([{ summary: "XTZ PENDING for 300 min (limit 120)", reason: "known_degraded: Chain halted, vendor aware" }]);
    // Stored as a proposal; the item is still pending.
    const stored = await p().dailyCheckItem.findUnique({ where: { id: it.id } });
    expect(stored!.status).toBe("pending");
    expect(JSON.parse(stored!.autoResult as string).fields.stuckCount).toBe(2);
  });

  it("the operator can pass using the collected evidence (required fields checked)", async () => {
    await add("sourceHeartbeat", { source: "komainu_api.transactions", expectedEveryMins: 2, lastSuccessAt: mins(WED, -1), lastCount: 0 });
    const it = await item("CHK-01");
    const r = await collectForItem(it.id as string, WED);
    await expect(passItem(it.id as string, { recordCount: r!.recordCount, dataAsOf: r!.dataAsOf, source: r!.source }, "emp-1", WED)).rejects.toThrow(/Evidence is missing: stuckCount/);
    const passed = await passItem(it.id as string, { recordCount: r!.recordCount, dataAsOf: r!.dataAsOf, source: r!.source, fields: r!.fields }, "emp-1", WED);
    expect(passed.status).toBe("pass");
  });

  it("CHK-03 counts requests by type and age band and proposes the old ones", async () => {
    await add("sourceHeartbeat", { source: "komainu_api.requests", expectedEveryMins: 1, lastSuccessAt: WED, lastCount: 3 });
    const req = (id: string, status: string, age: number) => add("sourceRecord", { source: "komainu_api", kind: "request", externalId: id, status, occurredAt: mins(WED, -age), fields: { type: "CREATE_TRANSACTION" } });
    await req("r1", "PENDING", 30);
    await req("r2", "BLOCKED", 300);
    await req("r3", "CREATED", 2000);
    const it = await item("CHK-03");
    const r = await collectForItem(it.id as string, WED);
    expect(r!.fields).toEqual({ byType: "CREATE_TRANSACTION/PENDING: 1, CREATE_TRANSACTION/BLOCKED: 1, CREATE_TRANSACTION/CREATED: 1", byAgeBand: "<1h: 1, 4-24h: 1, >24h: 1" });
    expect(r!.exceptions).toHaveLength(2);
  });

  it("CHK-10 summarises one window against the expected portfolios", async () => {
    await add("sourceHeartbeat", { source: "komainu_api.collateral", expectedEveryMins: 10, lastSuccessAt: WED, lastCount: 3 });
    await add("sourceRecord", { source: "komainu_api", kind: "portfolio", externalId: "pf-1", status: "ACTIVE", fields: { exchange: "okx" } });
    await add("sourceRecord", { source: "komainu_api", kind: "portfolio", externalId: "pf-2", status: "ACTIVE", fields: { exchange: "okx" } });
    await add("sourceRecord", { source: "komainu_api", kind: "settlement", externalId: "s1", status: "DONE", mappedStatus: "completed", occurredAt: new Date("2026-09-23T09:02:00Z"), fields: { exchange: "okx", portfolio_id: "pf-1" } });
    const it = await item("CHK-10", "2026-09-23:okx:09:00Z");
    const r = await collectForItem(it.id as string, new Date("2026-09-23T09:40:00Z"));
    expect(r!.fields).toEqual({ portfoliosExpected: 2, settlementsSeen: 1, completed: 1, failed: 0, inProgress: 0 });
    expect(r!.exceptions).toEqual([{ summary: "No settlement for portfolio in the okx 09:00Z window", reference: "pf-2" }]);
  });

  it("CHK-16 flags staked > total (position check, CF-09)", async () => {
    await add("sourceHeartbeat", { source: "komainu_api.eod_balances", expectedEveryMins: 1440, lastSuccessAt: WED, lastCount: 2 });
    await add("sourceRecord", { source: "komainu_api", kind: "eod_balance", externalId: "w1:2026-09-22", lastSeenAt: WED, fields: { asset: "ADA", staked_balance: 120, total_balance: 100 } });
    await add("sourceRecord", { source: "komainu_api", kind: "eod_balance", externalId: "w2:2026-09-22", lastSeenAt: WED, fields: { asset: "ADA", staked_balance: 50, total_balance: 100 } });
    const it = await item("CHK-16");
    const r = await collectForItem(it.id as string, WED);
    expect(r!.fields.positionViolations).toBe(1);
    expect(r!.exceptions.map((e) => e.summary)).toEqual(["ADA: staked balance exceeds total (position check)"]);
  });

  it("CHK-04 counts unscreenable (CF-04) and staking-excluded (CF-01) transactions separately", async () => {
    const entry = (id: string, data: Record<string, unknown>) => add("screeningEntry", { transactionId: id, asset: "ETH", amount: 1, txHash: "0xabc", screeningStatus: "completed", analyticsAlertId: "", isKnownException: false, exceptionReason: "", createdAt: mins(WED, -60), ...data });
    await entry("t1", {});
    await entry("t2", { analyticsAlertId: "ca-1" });
    await entry("t3", { amount: 0 });
    await entry("t4", { txHash: "" });
    await entry("t5", { isKnownException: true, exceptionReason: "Staking reward, excluded" });
    await entry("t6", { screeningStatus: "processing" });
    const it = await item("CHK-04");
    const r = await collectForItem(it.id as string, WED);
    expect(r).toMatchObject({ recordCount: 2, fields: { alertsCount: 1, unscreenableCount: 2, stakingExcludedCount: 1 }, notes: ["1 transaction(s) not yet screened."] });
  });

  it("reports the pull as unavailable (not a pass) when the source has never been polled", async () => {
    const it = await item("CHK-01");
    const r = await collectForItem(it.id as string, WED);
    expect(r).toMatchObject({ available: false, reason: "No successful Komainu transactions poll yet" });
  });

  it("returns null for checks without a data source", async () => {
    const it = await item("CHK-07");
    expect(await collectForItem(it.id as string, WED)).toBeNull();
  });

  it("masks references (H8)", () => {
    expect(redactRef("0x" + "a".repeat(40))).toBe("0xaa…aaaa");
    expect(redactRef("short")).toBe("short");
  });
});

describe("team boards", () => {
  it("shows the owning team's cards plus all-team tasks, with known issues and the Confluence placeholder", async () => {
    await generateDailyItems(WED);
    const board = await buildBoard("Team 1", { now: WED, canViewKps: false });
    const codes = board.map((c) => c.code);
    expect(codes).toContain("CHK-01");
    expect(codes).toContain("TASK-CLIENTQ");
    expect(codes).not.toContain("CHK-03");
    const chk01 = board.find((c) => c.code === "CHK-01")!;
    expect(chk01.items).toHaveLength(1);
    expect(chk01.knownIssues.map((k) => k.id)).toEqual(["CF-16", "CF-26"]);
    expect(chk01.confluenceUrl).toBeNull();
    expect(chk01.confluenceTitle).toBe("Stuck Transactions");
  });

  it("shows the approved-validator banner on CHK-08 until the set is populated", async () => {
    await syncDailyCheckDefinitions();
    let card = (await buildBoard("Team 1", { now: MON, canViewKps: false })).find((c) => c.code === "CHK-08")!;
    expect(card.banners).toContain(APPROVED_VALIDATORS_MISSING);
    await add("approvedValidator", { chain: "ethereum", validator: "v-1" });
    card = (await buildBoard("Team 1", { now: MON, canViewKps: false })).find((c) => c.code === "CHK-08")!;
    expect(card.banners).not.toContain(APPROVED_VALIDATORS_MISSING);
  });

  it("hides restricted KPS items without kps:view", async () => {
    await generateDailyItems(WED);
    const hidden = (await buildBoard("Team 1", { now: WED, canViewKps: false })).find((c) => c.code === "CHK-09K")!;
    expect(hidden.items).toHaveLength(0);
    expect(hidden.banners).toContain("Restricted: requires kps:view.");
    const shown = (await buildBoard("Team 1", { now: WED, canViewKps: true })).find((c) => c.code === "CHK-09K")!;
    expect(shown.items).toHaveLength(1);
  });

  it("kps:view is admins plus named users", async () => {
    expect(await canViewKps({ id: "u1", role: "admin" })).toBe(true);
    expect(await canViewKps({ id: "u2", role: "lead" })).toBe(false);
    await add("appSetting", { key: "kps.viewerUserIds", value: ["u2"] });
    expect(await canViewKps({ id: "u2", role: "lead" })).toBe(true);
  });
});
