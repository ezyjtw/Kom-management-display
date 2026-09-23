/**
 * Always-on job worker. Run with `npm run worker`.
 */

import { randomUUID } from "crypto";
import { hostname } from "os";
import {
  registerDefaultJobs,
  claimNextJob,
  completeJob,
  failJob,
  workerHeartbeat,
  recoverStaleJobs,
} from "@/lib/background-jobs";
import { dispatchJob } from "@/worker/dispatch";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export const HEARTBEAT_INTERVAL_MS = 30_000;
export const DRAIN_TIMEOUT_MS = 25_000;
const IDLE_POLL_MS = 2_000;
const STALE_CHECK_INTERVAL_MS = 60_000;

export interface WorkerDeps {
  registerDefaultJobs: typeof registerDefaultJobs;
  claimNextJob: typeof claimNextJob;
  completeJob: typeof completeJob;
  failJob: typeof failJob;
  workerHeartbeat: typeof workerHeartbeat;
  recoverStaleJobs: typeof recoverStaleJobs;
  dispatchJob: typeof dispatchJob;
  sleep: (ms: number) => Promise<void>;
}

const defaultDeps: WorkerDeps = {
  registerDefaultJobs,
  claimNextJob,
  completeJob,
  failJob,
  workerHeartbeat,
  recoverStaleJobs,
  dispatchJob,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class Worker {
  readonly id: string;
  private stopping = false;
  private inFlight: Promise<void> | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastStaleCheck = 0;

  constructor(private readonly deps: WorkerDeps = defaultDeps, id?: string) {
    this.id = id ?? `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  }

  get isStopping(): boolean {
    return this.stopping;
  }

  async start(): Promise<void> {
    logger.info("Worker starting", { workerId: this.id });
    await this.deps.registerDefaultJobs();
    await this.deps.workerHeartbeat(this.id);
    this.heartbeatTimer = setInterval(() => {
      void this.deps.workerHeartbeat(this.id);
    }, HEARTBEAT_INTERVAL_MS);

    while (!this.stopping) {
      const didWork = await this.tick();
      if (!didWork && !this.stopping) await this.deps.sleep(IDLE_POLL_MS);
    }
  }

  /** Claim and run at most one job. Returns true if a job was processed. */
  async tick(): Promise<boolean> {
    try {
      if (Date.now() - this.lastStaleCheck > STALE_CHECK_INTERVAL_MS) {
        this.lastStaleCheck = Date.now();
        await this.deps.recoverStaleJobs();
      }
      const job = await this.deps.claimNextJob();
      if (!job) return false;

      this.inFlight = this.runJob(job.id, job.type, job.payload);
      await this.inFlight;
      return true;
    } catch (error) {
      logger.error("Worker loop error", {
        workerId: this.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      this.inFlight = null;
    }
  }

  private async runJob(id: string, type: string, payload: unknown): Promise<void> {
    try {
      const result = await this.deps.dispatchJob(type, payload);
      await this.deps.completeJob(id, result);
    } catch (error) {
      await this.deps.failJob(id, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Stop claiming new jobs and wait up to DRAIN_TIMEOUT_MS for the in-flight
   * job. Returns true if it drained in time.
   */
  async stop(): Promise<boolean> {
    this.stopping = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    const current = this.inFlight;
    if (!current) return true;

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), DRAIN_TIMEOUT_MS);
    });
    const drained = await Promise.race([current.then(() => true as const), timeout]);
    if (timer) clearTimeout(timer);
    if (!drained) logger.warn("Worker drain timed out; job will be recovered as stale", { workerId: this.id });
    return drained;
  }
}

async function main(): Promise<void> {
  const worker = new Worker();

  const shutdown = async (signal: string) => {
    if (worker.isStopping) return;
    logger.info("Worker shutting down", { workerId: worker.id, signal });
    const drained = await worker.stop();
    await prisma.$disconnect().catch(() => {});
    process.exit(drained ? 0 : 1);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await worker.start();
}

if (require.main === module) {
  main().catch((error) => {
    logger.error("Worker crashed", { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
}
