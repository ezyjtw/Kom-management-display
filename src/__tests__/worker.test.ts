/**
 * Always-on worker (spec §6.1).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { Worker, DRAIN_TIMEOUT_MS, HEARTBEAT_INTERVAL_MS, type WorkerDeps } from "@/worker/index";

function makeDeps(overrides: Partial<WorkerDeps> = {}): WorkerDeps {
  return {
    registerDefaultJobs: vi.fn().mockResolvedValue(undefined),
    claimNextJob: vi.fn().mockResolvedValue(null),
    completeJob: vi.fn().mockResolvedValue(undefined),
    failJob: vi.fn().mockResolvedValue(undefined),
    workerHeartbeat: vi.fn().mockResolvedValue(undefined),
    recoverStaleJobs: vi.fn().mockResolvedValue(0),
    dispatchJob: vi.fn().mockResolvedValue({ ok: true }),
    sleep: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const job = { id: "j1", type: "check_sla", payload: {}, attempts: 1 };

describe("Worker.tick", () => {
  it("dispatches a claimed job and completes it", async () => {
    const deps = makeDeps({ claimNextJob: vi.fn().mockResolvedValueOnce(job) });
    expect(await new Worker(deps, "w").tick()).toBe(true);
    expect(deps.dispatchJob).toHaveBeenCalledWith("check_sla", {});
    expect(deps.completeJob).toHaveBeenCalledWith("j1", { ok: true });
    expect(deps.failJob).not.toHaveBeenCalled();
  });

  it("fails the job when the handler throws", async () => {
    const deps = makeDeps({
      claimNextJob: vi.fn().mockResolvedValueOnce(job),
      dispatchJob: vi.fn().mockRejectedValue(new Error("boom")),
    });
    await new Worker(deps, "w").tick();
    expect(deps.failJob).toHaveBeenCalledWith("j1", "boom");
    expect(deps.completeJob).not.toHaveBeenCalled();
  });

  it("returns false when there is nothing to do and survives DB errors", async () => {
    expect(await new Worker(makeDeps(), "w").tick()).toBe(false);
    const broken = makeDeps({ claimNextJob: vi.fn().mockRejectedValue(new Error("db down")) });
    expect(await new Worker(broken, "w").tick()).toBe(false);
  });
});

describe("Worker lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("registers default jobs and heartbeats every 30 seconds", async () => {
    // Real timer-based sleep (driven by the fake clock) so the idle loop yields.
    const deps = makeDeps({ sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
    const worker = new Worker(deps, "w1");
    const running = worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.registerDefaultJobs).toHaveBeenCalledTimes(1);
    expect(deps.workerHeartbeat).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 2);
    expect(deps.workerHeartbeat).toHaveBeenCalledTimes(3);
    expect(deps.workerHeartbeat).toHaveBeenCalledWith("w1");

    await worker.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    await running;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(deps.workerHeartbeat).toHaveBeenCalledTimes(3);
  });

  it("on stop, waits for the in-flight job to finish", async () => {
    let finish!: () => void;
    const deps = makeDeps({
      claimNextJob: vi.fn().mockResolvedValueOnce(job),
      dispatchJob: vi.fn(() => new Promise((r) => { finish = () => r("done"); })),
    });
    const worker = new Worker(deps, "w");
    const ticking = worker.tick();
    await vi.advanceTimersByTimeAsync(0);

    const stopping = worker.stop();
    await vi.advanceTimersByTimeAsync(1_000);
    finish();
    expect(await stopping).toBe(true);
    await ticking;
    expect(deps.completeJob).toHaveBeenCalledWith("j1", "done");
    expect(worker.isStopping).toBe(true);
  });

  it("gives up draining after 25 seconds", async () => {
    const deps = makeDeps({
      claimNextJob: vi.fn().mockResolvedValueOnce(job),
      dispatchJob: vi.fn(() => new Promise(() => {})),
    });
    const worker = new Worker(deps, "w");
    void worker.tick();
    await vi.advanceTimersByTimeAsync(0);

    const stopping = worker.stop();
    await vi.advanceTimersByTimeAsync(DRAIN_TIMEOUT_MS - 1);
    let settled = false;
    void stopping.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await stopping).toBe(false);
  });
});
