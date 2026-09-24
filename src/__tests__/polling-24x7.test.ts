/**
 * Spec v2 §6.1, §8.4, §8.5: Slack channels and shared mailboxes are polled
 * every 5 minutes, 24/7, from stored cursors; ALR-HB-SLACK / ALR-HB-MAIL fire
 * after two missed cycles at any time of day.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const db = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof import("@/__tests__/helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", async () => {
  const { createFakePrisma } = await import("@/__tests__/helpers/fake-prisma");
  db.client = createFakePrisma();
  return { prisma: db.client };
});
const envVars = vi.hoisted(() => ({ GRAPH_TENANT_ID: "tenant", GRAPH_CLIENT_ID: "id", GRAPH_CLIENT_SECRET: "s", NEXTAUTH_URL: "https://k.example" } as Record<string, string | undefined>));
vi.mock("@/lib/env", () => ({ env: (k: string) => envVars[k] }));
vi.mock("@/lib/http/allowed-hosts", () => ({ getAllowedHosts: () => new Set(["graph.microsoft.com", "login.microsoftonline.com"]) }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: vi.fn(async () => false) }));
vi.mock("@/lib/slack-rate-limiter", () => ({ acquireSlackToken: vi.fn(async () => undefined) }));

const slack = vi.hoisted(() => ({
  history: vi.fn(),
  replies: vi.fn(),
  fail: false,
}));
vi.mock("@/lib/integrations/slack", () => ({
  getSlackClient: () => ({
    conversations: {
      history: async (args: unknown) => { if (slack.fail) throw new Error("slack down"); return slack.history(args); },
      replies: async (args: unknown) => slack.replies(args),
    },
    chat: { postMessage: vi.fn(async () => ({ ok: true })), getPermalink: vi.fn(async () => ({ permalink: null })) },
    users: { lookupByEmail: vi.fn(async () => ({})) },
  }),
}));

import { CircuitBreaker } from "@/lib/circuit-breaker";
import { getNextCronRun } from "@/lib/background-jobs";
import { pollAllSlackChannels } from "@/modules/slack/services/slack-poller";
import { syncMailbox } from "@/modules/integrations/graph/sync";
import { runAlertEngine, syncRuleCatalogue } from "@/modules/alerting/engine";

const p = () => db.client;
const T0 = new Date("2026-09-23T00:00:00Z");
const tsOf = (d: Date) => (d.getTime() / 1000).toFixed(6);

beforeEach(async () => {
  p().__reset();
  CircuitBreaker.resetAll();
  slack.history.mockReset();
  slack.replies.mockReset();
  slack.fail = false;
  await p().slackChannel.create({ data: { id: "sc-1", channelId: "C1", channelName: "ops", channelType: "internal", purpose: "internal_ops", isActive: true, syncCursor: null } });
});
afterEach(() => vi.unstubAllGlobals());

describe("schedule", () => {
  it("runs sync_slack and sync_mail every 5 minutes through a whole day, with no out-of-hours gap", () => {
    for (const cron of ["*/5 * * * *"]) {
      const runs: Date[] = [];
      let t = new Date(T0.getTime() - 1000);
      while (runs.length < 288) {
        t = getNextCronRun(cron, t);
        runs.push(t);
      }
      expect(runs[0].toISOString()).toBe("2026-09-23T00:00:00.000Z");
      expect(runs.at(-1)!.toISOString()).toBe("2026-09-23T23:55:00.000Z");
      expect(runs.every((r, i) => i === 0 || r.getTime() - runs[i - 1].getTime() === 5 * 60_000)).toBe(true);
    }
  });

  it("registers both jobs at */5 and retires the old ones", async () => {
    const { registerDefaultJobs } = await import("@/lib/background-jobs");
    await p().backgroundJob.create({ data: { type: "sync_slack", cronExpression: "*/15 * * * *", isRecurring: true, payload: {}, status: "pending", nextRunAt: new Date() } });
    await p().backgroundJob.create({ data: { type: "graph_mail_sync", cronExpression: "*/3 * * * *", isRecurring: true, payload: {}, status: "pending", nextRunAt: new Date() } });
    await registerDefaultJobs();
    const jobs = await p().backgroundJob.findMany({ where: { isRecurring: true } });
    const cron = (type: string) => jobs.filter((j) => j.type === type).map((j) => j.cronExpression);
    expect(cron("sync_slack")).toEqual(["*/5 * * * *"]);
    expect(cron("sync_mail")).toEqual(["*/5 * * * *"]);
    expect(cron("graph_mail_sync")).toEqual([]);
    expect(cron("sync_slack_channel")).toEqual([]);
  });
});

describe("Slack cycle", () => {
  it("ingests new roots from the cursor and pulls replies for threads whose latest reply moved on", async () => {
    const now = new Date("2026-09-23T03:00:00Z"); // out of hours: polling still runs
    const old = tsOf(new Date(now.getTime() - 3 * 86_400_000));
    const fresh = tsOf(new Date(now.getTime() - 60_000));
    await p().slackChannel.update({ where: { id: "sc-1" }, data: { syncCursor: tsOf(new Date(now.getTime() - 3_600_000)) } });
    await p().commsThread.create({ data: { id: "th-old", source: "slack", sourceThreadRef: `C1-${old}`, slackChannelId: "sc-1", slackRootTs: old, slackLastReplyTs: old, subject: "old", status: "Unassigned" } });
    slack.history.mockResolvedValue({ messages: [
      { ts: fresh, text: "New question", user: "U1" },
      { ts: old, thread_ts: old, text: "old root", reply_count: 2, latest_reply: tsOf(new Date(now.getTime() - 120_000)) },
    ] });
    slack.replies.mockResolvedValue({ messages: [{ ts: old, text: "old root" }, { ts: tsOf(new Date(now.getTime() - 120_000)), text: "late reply", user: "U2" }] });

    const out = await pollAllSlackChannels(now);
    expect(out).toMatchObject({ polled: 1, failed: 0, newMessages: 1 });
    // The history window reaches back far enough to see replies on older threads.
    expect(Number(slack.history.mock.calls[0][0].oldest)).toBeLessThanOrEqual(now.getTime() / 1000 - 7 * 86_400 + 1);
    expect(slack.replies).toHaveBeenCalledWith(expect.objectContaining({ channel: "C1", ts: old }));
    expect((await p().slackChannel.findUnique({ where: { id: "sc-1" } }))!.syncCursor).toBe(fresh);
    expect(await p().sourceHeartbeat.findUnique({ where: { source: "slack.channels" } })).toMatchObject({ expectedEveryMins: 5 });
    expect(await p().pollCycle.findMany()).toEqual([expect.objectContaining({ source: "slack", ok: true, count: 1 })]);
  });

  it("does not re-ingest messages at or before the cursor", async () => {
    const now = new Date("2026-09-23T12:00:00Z");
    const seen = tsOf(new Date(now.getTime() - 600_000));
    await p().slackChannel.update({ where: { id: "sc-1" }, data: { syncCursor: seen } });
    slack.history.mockResolvedValue({ messages: [{ ts: seen, text: "already seen", user: "U1" }] });
    expect(await pollAllSlackChannels(now)).toMatchObject({ newMessages: 0 });
    expect(await p().commsThread.count()).toBe(0);
  });

  it("records a failed cycle and throws so the job retries next tick", async () => {
    slack.fail = true;
    await expect(pollAllSlackChannels(new Date())).rejects.toThrow("Slack poll failed for every channel");
    expect(await p().pollCycle.findMany()).toEqual([expect.objectContaining({ source: "slack", ok: false })]);
    expect(await p().sourceHeartbeat.count()).toBe(0);
  });
});

describe("mailbox cycle (Graph delta)", () => {
  function stubGraph(pages: Array<Record<string, unknown>>) {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: URL | string) => {
      const url = input.toString();
      if (url.includes("login.microsoftonline.com")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      calls.push(url);
      return new Response(JSON.stringify(pages.shift() ?? { value: [] }), { status: 200 });
    }));
    return calls;
  }
  const mailbox = { label: "vendor", address: "vendors@example.com", purpose: "vendor_notifications" as const };

  it("stores the delta link and continues from it on the next cycle, skipping removed items", async () => {
    const now = new Date("2026-09-23T02:00:00Z");
    const calls = stubGraph([
      { value: [{ id: "m1", subject: "Hello", receivedDateTime: "2026-09-23T01:55:00Z", from: { emailAddress: { address: "x@vendor.example" } } }, { id: "m0", "@removed": { reason: "deleted" } }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/users/vendors%40komainu.example/mailFolders/inbox/messages/delta?$deltatoken=abc" },
      { value: [] },
    ]);
    const first = await syncMailbox(mailbox, { now, parsers: [] });
    expect(first.fetched).toBe(1);
    expect((await p().syncCursor.findUnique({ where: { source: "outlook.vendor.inbox" } }))!.cursor).toContain("$deltatoken=abc");
    expect(await p().sourceHeartbeat.findUnique({ where: { source: "outlook.vendor" } })).toMatchObject({ expectedEveryMins: 5 });

    await syncMailbox(mailbox, { now: new Date(now.getTime() + 5 * 60_000), parsers: [] });
    expect(calls[1]).toContain("$deltatoken=abc");
  });

  it("skips mail older than a day on the very first sync of a folder", async () => {
    stubGraph([{ value: [{ id: "old", subject: "Old", receivedDateTime: "2026-09-20T00:00:00Z" }, { id: "new", subject: "New", receivedDateTime: "2026-09-23T01:00:00Z" }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/users/a/mailFolders/inbox/messages/delta?$deltatoken=z" }]);
    expect((await syncMailbox(mailbox, { now: new Date("2026-09-23T02:00:00Z"), parsers: [] })).fetched).toBe(1);
  });
});

describe("ALR-HB-SLACK after two missed cycles, at any hour", () => {
  it("fires 10 minutes after the last successful cycle, overnight", async () => {
    await syncRuleCatalogue();
    await p().alertRule.updateMany({ where: { code: "ALR-HB-SLACK" }, data: { enabled: true } });
    slack.history.mockResolvedValue({ messages: [] });

    // Cycles succeed through the night until 02:00, then Slack goes down.
    let t = new Date("2026-09-23T01:40:00Z");
    for (; t <= new Date("2026-09-23T02:00:00Z"); t = new Date(t.getTime() + 5 * 60_000)) {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(t);
      await pollAllSlackChannels(t);
      await runAlertEngine(t);
    }
    expect(await p().alert.count({ where: { ruleCode: "ALR-HB-SLACK" } })).toBe(0);

    slack.fail = true;
    const fired: string[] = [];
    for (; t <= new Date("2026-09-23T02:15:00Z"); t = new Date(t.getTime() + 5 * 60_000)) {
      vi.setSystemTime(t);
      await pollAllSlackChannels(t).catch(() => undefined);
      await runAlertEngine(t);
      if (await p().alert.count({ where: { ruleCode: "ALR-HB-SLACK" } })) fired.push(t.toISOString());
    }
    vi.useRealTimers();
    // 02:05 missed (5 min stale), 02:10 missed (10 min stale): fires at 02:10.
    expect(fired[0]).toBe("2026-09-23T02:10:00.000Z");
    const [alert] = await p().alert.findMany({ where: { ruleCode: "ALR-HB-SLACK" } });
    expect(alert.severity).toBe("critical");
  });
});
