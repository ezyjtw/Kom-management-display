/**
 * In-process job queue with retry, dead-letter, and idempotency.
 *
 * For production at scale, replace the in-memory store with Redis + BullMQ.
 * This implementation provides the same interface so the migration is seamless.
 */
import { randomUUID } from "crypto";
import { logger } from "@/lib/logger";
import {
  DEFAULT_RETRY_POLICIES,
  type Job,
  type JobHandler,
  type JobStatus,
  type JobType,
  type RetryPolicy,
} from "./types";

class JobQueue {
  private jobs = new Map<string, Job>();
  private handlers = new Map<JobType, JobHandler>();
  private idempotencyIndex = new Map<string, string>(); // key → jobId
  private processing = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Register a handler for a job type.
   */
  registerHandler(handler: JobHandler): void {
    this.handlers.set(handler.type, handler);
    logger.debug(`Job handler registered: ${handler.type}`);
  }

  /**
   * Enqueue a new job.
   * If an idempotencyKey is provided and a job with that key already exists,
   * the existing job is returned instead of creating a duplicate.
   */
  async enqueue(
    type: JobType,
    payload: Record<string, unknown>,
    opts?: {
      idempotencyKey?: string;
      scheduledAt?: Date;
      retryPolicy?: Partial<RetryPolicy>;
    },
  ): Promise<Job> {
    // Idempotency check
    if (opts?.idempotencyKey) {
      const existingId = this.idempotencyIndex.get(opts.idempotencyKey);
      if (existingId) {
        const existing = this.jobs.get(existingId);
        if (existing) {
          logger.debug(`Job deduplicated: ${opts.idempotencyKey}`);
          return existing;
        }
      }
    }

    const policy = { ...DEFAULT_RETRY_POLICIES[type], ...opts?.retryPolicy };

    const job: Job = {
      id: randomUUID(),
      type,
      status: "pending",
      payload,
      idempotencyKey: opts?.idempotencyKey,
      attempts: 0,
      maxAttempts: policy.maxAttempts,
      retryPolicy: policy,
      scheduledAt: opts?.scheduledAt || new Date(),
      createdAt: new Date(),
    };

    this.jobs.set(job.id, job);
    if (opts?.idempotencyKey) {
      this.idempotencyIndex.set(opts.idempotencyKey, job.id);
    }

    logger.info(`Job enqueued: ${type}`, { jobId: job.id, idempotencyKey: opts?.idempotencyKey });
    return job;
  }

  /**
   * Process pending jobs.
   */
  async processNext(): Promise<boolean> {
    const now = new Date();
    const pending = Array.from(this.jobs.values())
      .filter((j) => j.status === "pending" && j.scheduledAt <= now)
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

    if (pending.length === 0) return false;

    const job = pending[0];
    const handler = this.handlers.get(job.type);

    if (!handler) {
      logger.warn(`No handler for job type: ${job.type}`, { jobId: job.id });
      job.status = "dead_letter";
      job.lastError = `No handler registered for type: ${job.type}`;
      return true;
    }

    job.status = "processing";
    job.startedAt = new Date();
    job.attempts++;

    try {
      await handler.handle(job.payload);
      job.status = "completed";
      job.completedAt = new Date();
      logger.info(`Job completed: ${job.type}`, {
        jobId: job.id,
        duration: job.completedAt.getTime() - (job.startedAt?.getTime() || 0),
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      job.lastError = errMsg;

      if (job.attempts >= job.maxAttempts) {
        job.status = "dead_letter";
        logger.error(`Job moved to dead letter: ${job.type}`, {
          jobId: job.id,
          attempts: job.attempts,
          error: errMsg,
        });
      } else {
        // Schedule retry with backoff
        const retryPolicy = job.retryPolicy;
        const backoff = Math.min(
          retryPolicy.backoffMs * Math.pow(retryPolicy.backoffMultiplier, job.attempts - 1),
          retryPolicy.maxBackoffMs,
        );
        job.status = "pending";
        job.scheduledAt = new Date(Date.now() + backoff);

        logger.warn(`Job retry scheduled: ${job.type}`, {
          jobId: job.id,
          attempt: job.attempts,
          nextRetryMs: backoff,
          error: errMsg,
        });
      }
    }

    return true;
  }

  /**
   * Start processing jobs on an interval.
   */
  start(intervalMs = 1000): void {
    if (this.pollInterval) return;
    this.processing = true;
    this.pollInterval = setInterval(async () => {
      if (!this.processing) return;
      try {
        while (await this.processNext()) {
          // Process all ready jobs in burst
        }
      } catch (error) {
        logger.error("Job queue processing error", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, intervalMs);
    logger.info("Job queue started", { intervalMs });
  }

  /**
   * Stop processing.
   */
  stop(): void {
    this.processing = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    logger.info("Job queue stopped");
  }

  /**
   * Get queue statistics.
   */
  getStats(): Record<JobStatus, number> {
    const stats: Record<JobStatus, number> = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      dead_letter: 0,
    };
    for (const job of this.jobs.values()) {
      stats[job.status]++;
    }
    return stats;
  }

  /**
   * Get dead letter jobs for inspection.
   */
  getDeadLetterJobs(): Job[] {
    return Array.from(this.jobs.values()).filter((j) => j.status === "dead_letter");
  }

  /**
   * Retry a dead letter job.
   */
  retryDeadLetter(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "dead_letter") return false;
    job.status = "pending";
    job.attempts = 0;
    job.scheduledAt = new Date();
    job.lastError = undefined;
    return true;
  }

  /**
   * Clean up completed and old dead-letter jobs.
   */
  cleanup(maxAgeMs = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    let cleaned = 0;
    for (const [id, job] of this.jobs) {
      if (
        (job.status === "completed" || job.status === "dead_letter") &&
        job.createdAt.getTime() < cutoff
      ) {
        this.jobs.delete(id);
        if (job.idempotencyKey) {
          this.idempotencyIndex.delete(job.idempotencyKey);
        }
        cleaned++;
      }
    }
    return cleaned;
  }
}

/** Singleton job queue instance */
export const jobQueue = new JobQueue();
