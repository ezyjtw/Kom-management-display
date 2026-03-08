/**
 * Job queue tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// We need to mock the logger before importing the queue
vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("Job Queue", () => {
  let jobQueue: Awaited<typeof import("@/modules/jobs/queue")>["jobQueue"];

  beforeEach(async () => {
    // Re-import to get a fresh instance each time
    vi.resetModules();
    const mod = await import("@/modules/jobs/queue");
    jobQueue = mod.jobQueue;
  });

  it("enqueues a job with pending status", async () => {
    const job = await jobQueue.enqueue("sla_scan", { target: "all" });
    expect(job.id).toBeDefined();
    expect(job.status).toBe("pending");
    expect(job.type).toBe("sla_scan");
    expect(job.attempts).toBe(0);
  });

  it("deduplicates jobs with same idempotency key", async () => {
    const job1 = await jobQueue.enqueue("email_sync", { mailbox: "ops" }, { idempotencyKey: "sync-001" });
    const job2 = await jobQueue.enqueue("email_sync", { mailbox: "ops" }, { idempotencyKey: "sync-001" });
    expect(job1.id).toBe(job2.id);
  });

  it("processes a job with a registered handler", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    jobQueue.registerHandler({ type: "sla_scan", handle: handler });

    await jobQueue.enqueue("sla_scan", { scope: "threads" });
    const processed = await jobQueue.processNext();

    expect(processed).toBe(true);
    expect(handler).toHaveBeenCalledWith({ scope: "threads" });
  });

  it("moves to dead letter after max attempts", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("Connection failed"));
    jobQueue.registerHandler({ type: "email_sync", handle: handler });

    await jobQueue.enqueue("email_sync", { mailbox: "ops" }, {
      retryPolicy: { maxAttempts: 2, backoffMs: 0, backoffMultiplier: 1, maxBackoffMs: 0 },
    });

    // First attempt: fails, retries
    await jobQueue.processNext();
    // Second attempt: fails, dead letter
    await jobQueue.processNext();

    const deadLetters = jobQueue.getDeadLetterJobs();
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0].lastError).toBe("Connection failed");
  });

  it("reports queue stats correctly", async () => {
    jobQueue.registerHandler({ type: "sla_scan", handle: vi.fn().mockResolvedValue(undefined) });

    await jobQueue.enqueue("sla_scan", { a: 1 });
    await jobQueue.enqueue("sla_scan", { b: 2 });
    await jobQueue.processNext();

    const stats = jobQueue.getStats();
    expect(stats.pending).toBe(1);
    expect(stats.completed).toBe(1);
  });

  it("retries dead letter jobs", async () => {
    const handler = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue(undefined);
    jobQueue.registerHandler({ type: "alert_generate", handle: handler });

    await jobQueue.enqueue("alert_generate", {}, {
      retryPolicy: { maxAttempts: 1, backoffMs: 0, backoffMultiplier: 1, maxBackoffMs: 0 },
    });

    await jobQueue.processNext();
    const dead = jobQueue.getDeadLetterJobs();
    expect(dead).toHaveLength(1);

    const retried = jobQueue.retryDeadLetter(dead[0].id);
    expect(retried).toBe(true);

    await jobQueue.processNext();
    expect(jobQueue.getStats().completed).toBe(1);
  });
});
