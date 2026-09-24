/**
 * Job queue scheduling: cron via cron-parser, no overlap, stale recovery, dispatch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  backgroundJob: {
    findMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { getNextCronRun, claimNextJob, recoverStaleJobs, STALE_RUNNING_MS } from "@/lib/background-jobs";
import { dispatchJob, JOB_HANDLERS } from "@/worker/dispatch";

const FROM = new Date("2026-03-10T10:07:30Z");

describe("getNextCronRun (cron-parser, UTC)", () => {
  it.each([
    ["*/5 * * * *", "2026-03-10T10:10:00.000Z"],
    ["*/1 * * * *", "2026-03-10T10:08:00.000Z"],
    ["0 */6 * * *", "2026-03-10T12:00:00.000Z"],
    ["0 2 * * *", "2026-03-11T02:00:00.000Z"],
    ["30 7 * * 1-5", "2026-03-11T07:30:00.000Z"],
  ])("%s → %s", (cron, expected) => {
    expect(getNextCronRun(cron, FROM).toISOString()).toBe(expected);
  });

  it("falls back to five minutes for an invalid expression", () => {
    expect(getNextCronRun("not a cron", FROM).getTime()).toBe(FROM.getTime() + 5 * 60_000);
  });
});

describe("claimNextJob", () => {
  beforeEach(() => vi.clearAllMocks());

  const recurring = { id: "r1", type: "sync_jira", status: "pending", isRecurring: true, cronExpression: "*/10 * * * *", attempts: 0, payload: {} };
  const oneOff = { id: "o1", type: "check_sla", status: "pending", isRecurring: false, cronExpression: null, attempts: 0, payload: {} };

  it("skips a recurring job while a previous run of the same type is running", async () => {
    prismaMock.backgroundJob.findMany.mockResolvedValue([recurring, oneOff]);
    prismaMock.backgroundJob.count.mockResolvedValue(1);
    prismaMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });

    const claimed = await claimNextJob();

    expect(claimed?.id).toBe("o1");
    const reschedule = prismaMock.backgroundJob.updateMany.mock.calls[0][0];
    expect(reschedule.where.id).toBe("r1");
    expect(reschedule.data.nextRunAt).toBeInstanceOf(Date);
    expect(reschedule.data.status).toBeUndefined();
  });

  it("claims a recurring job when nothing of its type is running", async () => {
    prismaMock.backgroundJob.findMany.mockResolvedValue([recurring]);
    prismaMock.backgroundJob.count.mockResolvedValue(0);
    prismaMock.backgroundJob.updateMany.mockResolvedValue({ count: 1 });

    expect(await claimNextJob()).toMatchObject({ id: "r1", attempts: 1 });
    expect(prismaMock.backgroundJob.updateMany.mock.calls[0][0].data.status).toBe("running");
  });

  it("moves on when another worker claimed the job first", async () => {
    prismaMock.backgroundJob.findMany.mockResolvedValue([oneOff]);
    prismaMock.backgroundJob.updateMany.mockResolvedValue({ count: 0 });
    expect(await claimNextJob()).toBeNull();
  });
});

describe("recoverStaleJobs", () => {
  it("re-queues jobs running longer than the stale threshold, excluding heartbeats", async () => {
    prismaMock.backgroundJob.updateMany.mockResolvedValue({ count: 2 });
    const now = new Date("2026-03-10T12:00:00Z");
    expect(await recoverStaleJobs(now)).toBe(2);
    const { where, data } = prismaMock.backgroundJob.updateMany.mock.calls.at(-1)![0];
    expect(where.startedAt.lt.getTime()).toBe(now.getTime() - STALE_RUNNING_MS);
    expect(where.type).toEqual({ not: "worker_heartbeat" });
    expect(data.status).toBe("retrying");
  });
});

describe("dispatch", () => {
  it("has a handler for every job type the queue can hold", () => {
    expect(Object.keys(JOB_HANDLERS).sort()).toEqual([
      "alert_digest", "check_confirmations", "check_sla", "check_staking", "classify_thread", "cleanup_sessions", "collect_check_evidence", "data_retention",
      "draft_client_comms", "evaluate_alerts", "generate_daily_checks", "graph_teams_sync", "gx_sprint_intake", "iai_overdue",
      "komainu_poll_audit_logs", "komainu_poll_collateral", "komainu_poll_eod_balances",
      "komainu_poll_requests", "komainu_poll_stakes", "komainu_poll_staking", "komainu_poll_transactions", "morning_handover", "mtd_autoclose",
      "poll_client_ticket_comments", "poll_risk_signals", "poll_status_pages", "reconcile_tickets", "report_unticketed", "score_vendor_reliability", "slack_event",
      "sync_jira", "sync_mail", "sync_slack", "sync_slack_replies",
    ]);
  });

  it("throws for unknown types so they are retried and dead-lettered, not silently completed", async () => {
    await expect(dispatchJob("nope", {})).rejects.toThrow("Unknown job type: nope");
  });

  it("validates required payload fields", async () => {
    await expect(dispatchJob("sync_slack_replies", {})).rejects.toThrow(/channelId and threadTs/);
    await expect(dispatchJob("classify_thread", null)).rejects.toThrow(/threadId/);
  });
});
