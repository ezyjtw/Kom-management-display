/**
 * Load review (Phase 12n): refresh rates, load and cost.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createFakePrisma } from "./helpers/fake-prisma";

const fake = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof createFakePrisma> }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return fake.db;
  },
}));

import {
  DEFAULT_JOB_SCHEDULES,
  FIXED_SCHEDULE_JOBS,
  effectiveSchedules,
  scheduleIntervalMins,
  scheduleOverrideProblem,
} from "@/lib/job-schedules";
import { completeJob, syncJobSchedules, isNoOpResult } from "@/lib/background-jobs";
import { upsertSourceRecords, changedExternalIds } from "@/modules/integrations/source-records";
import { checkWorkerHealth, resetWorkerHealthThrottle, ALERT_MAINTENANCE_MS } from "@/lib/worker-health";
import { SETTINGS } from "@/modules/settings/registry";

beforeEach(() => {
  fake.db = createFakePrisma();
});

describe("job schedules", () => {
  it("keeps Slack and mailbox polling at every 5 minutes, 24/7 (standing rule)", () => {
    expect(DEFAULT_JOB_SCHEDULES.sync_slack).toBe("*/5 * * * *");
    expect(DEFAULT_JOB_SCHEDULES.sync_mail).toBe("*/5 * * * *");
    for (const job of FIXED_SCHEDULE_JOBS) {
      expect(scheduleOverrideProblem(job, "*/30 * * * *")).toMatch(/fixed/);
      expect(effectiveSchedules({ [job]: "0 * * * *" })[job]).toBe("*/5 * * * *");
    }
  });

  it("polls pending custody requests every 2 minutes by default", () => {
    expect(DEFAULT_JOB_SCHEDULES.custody_poll_requests).toBe("*/2 * * * *");
  });

  it("no longer schedules the unused SLA count job", () => {
    expect("check_sla" in DEFAULT_JOB_SCHEDULES).toBe(false);
  });

  it("accepts valid overrides and refuses unknown jobs, bad cron and extreme cadences", () => {
    expect(scheduleOverrideProblem("custody_poll_requests", "*/5 * * * *")).toBeNull();
    expect(scheduleOverrideProblem("nope", "*/5 * * * *")).toMatch(/unknown/);
    expect(scheduleOverrideProblem("custody_poll_requests", "not a cron")).toMatch(/invalid/);
    expect(scheduleOverrideProblem("custody_poll_requests", "*/10 * * * * *")).toMatch(/5-field/);
    expect(scheduleOverrideProblem("custody_poll_requests", "0 0 * * 1")).toMatch(/less than once a day/);
    expect(effectiveSchedules({ custody_poll_requests: "*/5 * * * *", nope: "* * * * *" }).custody_poll_requests).toBe("*/5 * * * *");
  });

  it("the settings schema rejects a bad override with the reason", () => {
    const parsed = SETTINGS["jobs.schedules"].schema.safeParse({ sync_slack: "*/30 * * * *" });
    expect(parsed.success).toBe(false);
    expect(SETTINGS["jobs.schedules"].schema.safeParse({ custody_poll_collateral: "*/15 * * * *" }).success).toBe(true);
  });

  it("derives the heartbeat expectation from the cadence", () => {
    expect(scheduleIntervalMins("*/2 * * * *")).toBe(2);
    expect(scheduleIntervalMins("0 7 * * *")).toBe(24 * 60);
    expect(scheduleIntervalMins("TZ=Europe/London */15 9-11 * * 1-5")).toBe(15);
  });

  it("applies an admin override to the stored job and recomputes its next run", async () => {
    const db = fake.db;
    await db.backgroundJob.create({ data: { id: "j1", type: "custody_poll_requests", isRecurring: true, cronExpression: "*/2 * * * *", status: "pending", nextRunAt: new Date(0) } });
    await db.appSetting.create({ data: { key: "jobs.schedules", value: { custody_poll_requests: "*/5 * * * *" } } });
    const now = new Date("2026-09-25T10:01:00Z");
    expect(await syncJobSchedules(now)).toBe(1);
    const row = await db.backgroundJob.findUnique({ where: { id: "j1" } });
    expect(row!.cronExpression).toBe("*/5 * * * *");
    expect((row!.nextRunAt as Date).toISOString()).toBe("2026-09-25T10:05:00.000Z");
    expect(await syncJobSchedules(now)).toBe(0);
  });
});

describe("job run history", () => {
  const job = (type: string) => ({ id: `j-${type}`, type, isRecurring: true, cronExpression: "*/5 * * * *", status: "running", attempts: 1, startedAt: new Date() });

  it("does not write a run row when the job had nothing to do", async () => {
    await fake.db.backgroundJob.create({ data: job("custody_poll_requests") });
    await completeJob("j-custody_poll_requests", { skipped: true, reason: "custody API not configured" });
    expect(await fake.db.backgroundJobRun.count()).toBe(0);
    const row = await fake.db.backgroundJob.findUnique({ where: { id: "j-custody_poll_requests" } });
    expect(row!.lastRunAt).toBeInstanceOf(Date);
  });

  it("writes a run row for work done, and always for retention (evidence)", async () => {
    await fake.db.backgroundJob.create({ data: job("sync_jira") });
    await completeJob("j-sync_jira", { synced: 3 });
    await fake.db.backgroundJob.create({ data: job("data_retention") });
    await completeJob("j-data_retention", { skipped: true, reason: "retention.enabled is off" });
    const runs = await fake.db.backgroundJobRun.findMany();
    expect(runs.map((r) => r.type).sort()).toEqual(["data_retention", "sync_jira"]);
  });

  it("recognises only an explicit skipped result as a no-op", () => {
    expect(isNoOpResult({ skipped: true })).toBe(true);
    expect(isNoOpResult({ skipped: false })).toBe(false);
    expect(isNoOpResult({ count: 0 })).toBe(false);
    expect(isNoOpResult(undefined)).toBe(false);
  });
});

describe("source records are written only when they change", () => {
  const rec = (status: string) => ({ externalId: "r1", credentialLabel: "main", status, occurredAt: new Date("2026-09-25T09:00:00Z"), fields: { b: 2, a: 1 } });

  it("an unchanged record gets only its lastSeenAt refreshed; a changed one is rewritten", async () => {
    expect(await upsertSourceRecords("custody_api", "request", [rec("PENDING")])).toEqual({ total: 1, written: 1 });
    const upsert = vi.spyOn(fake.db.sourceRecord, "upsert");
    const first = (await fake.db.sourceRecord.findMany())[0];

    await new Promise((r) => setTimeout(r, 5));
    expect(await upsertSourceRecords("custody_api", "request", [{ ...rec("PENDING"), fields: { a: 1, b: 2 } }])).toEqual({ total: 1, written: 0 });
    expect(upsert).not.toHaveBeenCalled();
    const second = (await fake.db.sourceRecord.findMany())[0];
    expect((second.lastSeenAt as Date).getTime()).toBeGreaterThan((first.lastSeenAt as Date).getTime());

    expect(await upsertSourceRecords("custody_api", "request", [rec("APPROVED")])).toEqual({ total: 1, written: 1 });
    expect((await fake.db.sourceRecord.findMany())[0].status).toBe("APPROVED");
  });

  it("reports which records are new or changed without writing", async () => {
    await upsertSourceRecords("graph_teams", "teams_message", [{ externalId: "m1", fields: { text: "a" } }]);
    const changed = await changedExternalIds("graph_teams", "teams_message", [
      { externalId: "m1", fields: { text: "a" } },
      { externalId: "m2", fields: { text: "b" } },
      { externalId: "m1x", fields: {} },
    ]);
    expect([...changed].sort()).toEqual(["m1x", "m2"]);
    expect(await fake.db.sourceRecord.count()).toBe(1);
  });
});

describe("worker health check", () => {
  beforeEach(() => resetWorkerHealthThrottle());

  it("reads the worker state on every call but maintains the alert at most once a minute", async () => {
    await fake.db.backgroundJob.create({ data: { type: "worker_heartbeat", status: "completed", lastRunAt: new Date(), isRecurring: false } });
    const updateMany = vi.spyOn(fake.db.alert, "updateMany");
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) expect(await checkWorkerHealth(t0 + i * 1000)).toEqual({ workerAlive: true });
    expect(updateMany).toHaveBeenCalledTimes(1);
    await checkWorkerHealth(t0 + ALERT_MAINTENANCE_MS + 1);
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it("acts at once when the worker state changes", async () => {
    const create = vi.spyOn(fake.db.alert, "create");
    await fake.db.backgroundJob.create({ data: { id: "hb", type: "worker_heartbeat", status: "completed", lastRunAt: new Date(), isRecurring: false } });
    const t0 = Date.now();
    await checkWorkerHealth(t0);
    await fake.db.backgroundJob.update({ where: { id: "hb" }, data: { lastRunAt: new Date(0) } });
    expect(await checkWorkerHealth(t0 + 1000)).toEqual({ workerAlive: false });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("shared push connection", () => {
  class FakeEventSource {
    static instances: FakeEventSource[] = [];
    closed = false;
    onerror: (() => void) | null = null;
    private handlers = new Map<string, Array<(e: { data: string }) => void>>();
    constructor(public url: string) {
      FakeEventSource.instances.push(this);
    }
    addEventListener(type: string, fn: (e: { data: string }) => void) {
      this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
    }
    emit(type: string, data: unknown) {
      for (const fn of this.handlers.get(type) ?? []) fn({ data: JSON.stringify(data) });
    }
    close() {
      this.closed = true;
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    vi.stubGlobal("window", {});
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens one connection for every listener in the tab and closes after the last leaves", async () => {
    const { subscribeSSE, sseConnectionCount } = await import("@/hooks/useSSE");
    const got: string[][] = [[], [], []];
    const unsubs = got.map((bucket) => subscribeSSE((e) => bucket.push(e.type), () => {}));
    expect(FakeEventSource.instances).toHaveLength(1);
    FakeEventSource.instances[0].emit("alert", { id: "a1" });
    expect(got.map((b) => b.length)).toEqual([1, 1, 1]);

    unsubs.forEach((u) => u());
    expect(sseConnectionCount()).toBe(1); // grace period: a route change does not reconnect
    const again = subscribeSSE(() => {}, () => {});
    expect(FakeEventSource.instances).toHaveLength(1);
    again();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sseConnectionCount()).toBe(0);
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });
});

describe("browser refreshes", () => {
  function sources(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const f = path.join(dir, e.name);
      return e.isDirectory() ? sources(f) : /\.tsx?$/.test(e.name) ? [f] : [];
    });
  }
  const ui = [...sources("src/app"), ...sources("src/components"), ...sources("src/hooks")].filter((f) => !f.includes(`${path.sep}api${path.sep}`));

  it("every automatic poll is marked as background, so it is not user activity", () => {
    const offenders = ui.filter((f) => {
      const src = fs.readFileSync(f, "utf8");
      return /setInterval\(/.test(src) && /\bfetch\(/.test(src) && !/backgroundFetch/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it("background requests do not refresh the session's idle clock", () => {
    const auth = fs.readFileSync("src/lib/auth-user.ts", "utf8");
    expect(auth).toMatch(/if \(jti && !\(await isBackgroundRequest\(\)\)\) \{\n\s*updateLastActive\(jti\)/);
    expect(fs.readFileSync("src/lib/client/background-fetch.ts", "utf8")).toMatch(/headers\.set\(BACKGROUND_REQUEST_HEADER, "1"\)/);
  });

  it("the app shell polls only while the tab is visible", () => {
    for (const f of ["src/components/shared/WorkerStatusBanner.tsx", "src/components/shared/Sidebar.tsx"]) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, f).toMatch(/useVisiblePolling\(/);
      expect(src, f).not.toMatch(/setInterval\(/);
    }
  });

  it("push events no longer cost a database round trip", () => {
    expect(fs.existsSync("src/lib/pg-notify.ts")).toBe(false);
    expect(fs.readFileSync("src/lib/sse.ts", "utf8")).not.toMatch(/pg_notify|publishEvent/);
  });
});
