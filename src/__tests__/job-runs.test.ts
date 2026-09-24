/**
 * Durable job run history (review remediation): a recurring job that
 * dead-letters is rescheduled, but the dead-lettered run stays on record.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof import("@/__tests__/helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", async () => {
  const { createFakePrisma } = await import("@/__tests__/helpers/fake-prisma");
  db.client = createFakePrisma();
  return { prisma: db.client };
});

import { completeJob, failJob, getDeadLetteredRuns, getJobQueueStatus, pruneJobRuns } from "@/lib/background-jobs";

const p = () => db.client;

beforeEach(() => p().__reset());

async function job(data: Record<string, unknown>) {
  return p().backgroundJob.create({ data: { status: "running", payload: {}, error: "", attempts: 1, maxAttempts: 3, startedAt: new Date(), deadLetterReason: "", priority: 2, ...data } });
}

describe("background job run history", () => {
  it("keeps the dead-lettered run of a recurring job after it is rescheduled", async () => {
    const j = await job({ type: "morning_handover", isRecurring: true, cronExpression: "*/15 * * * *" });
    await failJob(String(j.id), "Jira unavailable");
    await p().backgroundJob.update({ where: { id: j.id }, data: { attempts: 2, status: "running" } });
    await failJob(String(j.id), "Jira unavailable");
    await p().backgroundJob.update({ where: { id: j.id }, data: { attempts: 3, status: "running" } });
    await failJob(String(j.id), "Jira still unavailable");

    const after = await p().backgroundJob.findUnique({ where: { id: j.id } });
    expect(after).toMatchObject({ status: "pending", attempts: 0, deadLetteredAt: null }); // rescheduled

    const runs = await p().backgroundJobRun.findMany({ where: { jobId: j.id } });
    expect(runs.map((r) => r.status)).toEqual(["retrying", "retrying", "dead_lettered"]);
    expect(await getDeadLetteredRuns()).toEqual([expect.objectContaining({ jobId: j.id, type: "morning_handover", attempt: 3, error: "Jira still unavailable" })]);
    expect((await getJobQueueStatus()).summary.deadLettered24h).toBe(1);
  });

  it("records successful runs, and pruning keeps failures longer than successes", async () => {
    const j = await job({ type: "sync_slack" });
    await completeJob(String(j.id), { ingested: 3 });
    expect(await p().backgroundJobRun.findMany({ where: { jobId: j.id } })).toEqual([expect.objectContaining({ status: "succeeded", result: { ingested: 3 } })]);

    const old = new Date(Date.now() - 60 * 86_400_000);
    await p().backgroundJobRun.create({ data: { jobId: "x", type: "t", attempt: 1, status: "succeeded", finishedAt: old } });
    await p().backgroundJobRun.create({ data: { jobId: "x", type: "t", attempt: 3, status: "dead_lettered", finishedAt: old } });
    expect(await pruneJobRuns()).toBe(1);
    expect((await p().backgroundJobRun.findMany({ where: { jobId: "x" } })).map((r) => r.status)).toEqual(["dead_lettered"]);
  });
});
