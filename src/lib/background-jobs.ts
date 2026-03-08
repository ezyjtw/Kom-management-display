/**
 * Background job queue using PostgreSQL (via Prisma).
 *
 * Provides a simple, reliable job queue without external dependencies like Redis.
 * Jobs are stored in the BackgroundJob table and processed via polling.
 *
 * Job types:
 * - sync_slack: Poll Slack channels for new messages
 * - sync_email: Poll IMAP mailboxes for new emails
 * - sync_jira: Poll Jira for issue updates
 * - check_sla: Monitor SLA deadlines and generate alerts
 * - check_staking: Check staking reward heartbeats
 * - poll_komainu: Poll Komainu API for new transactions/requests
 * - check_confirmations: Check for expired transaction confirmations
 * - cleanup_sessions: Clean up expired session metadata
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export type JobType =
  | "sync_slack"
  | "sync_email"
  | "sync_jira"
  | "check_sla"
  | "check_staking"
  | "poll_komainu"
  | "check_confirmations"
  | "cleanup_sessions";

export interface JobDefinition {
  type: JobType;
  handler: (payload: Record<string, unknown>) => Promise<unknown>;
  cronExpression: string;
  description: string;
}

/**
 * Register default recurring jobs.
 * Call this on application startup to ensure all recurring jobs exist.
 */
export async function registerDefaultJobs(): Promise<void> {
  const defaultJobs: Array<{
    type: string;
    cronExpression: string;
    payload?: Record<string, unknown>;
  }> = [
    { type: "sync_slack", cronExpression: "*/5 * * * *" },       // Every 5 mins
    { type: "sync_email", cronExpression: "*/3 * * * *" },       // Every 3 mins
    { type: "sync_jira", cronExpression: "*/10 * * * *" },       // Every 10 mins
    { type: "check_sla", cronExpression: "*/1 * * * *" },        // Every minute
    { type: "check_staking", cronExpression: "0 */6 * * *" },    // Every 6 hours
    { type: "poll_komainu", cronExpression: "*/2 * * * *" },     // Every 2 mins
    { type: "check_confirmations", cronExpression: "*/5 * * * *" }, // Every 5 mins
    { type: "cleanup_sessions", cronExpression: "0 2 * * *" },   // Daily at 2am
  ];

  for (const job of defaultJobs) {
    const existing = await prisma.backgroundJob.findFirst({
      where: { type: job.type, isRecurring: true },
    });

    if (!existing) {
      await prisma.backgroundJob.create({
        data: {
          type: job.type,
          cronExpression: job.cronExpression,
          isRecurring: true,
          payload: (job.payload ?? {}) as any,
          status: "pending",
          nextRunAt: new Date(),
        },
      });
      logger.job(job.type, `Registered recurring job: ${job.cronExpression}`);
    }
  }
}

/**
 * Enqueue a one-off job for immediate execution.
 */
export async function enqueueJob(
  type: JobType,
  payload: Record<string, unknown> = {},
  opts?: { runAt?: Date; maxAttempts?: number },
): Promise<string> {
  const job = await prisma.backgroundJob.create({
    data: {
      type,
      payload: payload as any,
      nextRunAt: opts?.runAt ?? new Date(),
      maxAttempts: opts?.maxAttempts ?? 3,
      isRecurring: false,
    },
  });

  logger.job(type, `Job enqueued: ${job.id}`);
  return job.id;
}

/**
 * Fetch and lock the next pending job for processing.
 * Uses an atomic update to prevent double-processing.
 */
export async function claimNextJob(): Promise<{
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
} | null> {
  // Find the oldest pending job that's due
  const job = await prisma.backgroundJob.findFirst({
    where: {
      status: { in: ["pending", "retrying"] },
      nextRunAt: { lte: new Date() },
    },
    orderBy: { nextRunAt: "asc" },
  });

  if (!job) return null;

  // Atomically claim the job
  try {
    await prisma.backgroundJob.update({
      where: { id: job.id, status: job.status },
      data: {
        status: "running",
        startedAt: new Date(),
        attempts: job.attempts + 1,
      },
    });
  } catch {
    // Another worker claimed it
    return null;
  }

  return {
    id: job.id,
    type: job.type,
    payload: job.payload,
    attempts: job.attempts + 1,
  };
}

/**
 * Mark a job as completed.
 */
export async function completeJob(jobId: string, result?: unknown): Promise<void> {
  const job = await prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: "completed",
      completedAt: new Date(),
      result: result ? JSON.parse(JSON.stringify(result)) : undefined,
      lastRunAt: new Date(),
    },
  });

  // If recurring, schedule the next run
  if (job.isRecurring && job.cronExpression) {
    const nextRun = getNextCronRun(job.cronExpression);
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: "pending",
        nextRunAt: nextRun,
        startedAt: null,
        completedAt: null,
        result: undefined,
        error: "",
      },
    });
  }

  logger.job(job.type, `Job completed: ${jobId}`);
}

/**
 * Mark a job as failed. Retries with exponential backoff.
 */
export async function failJob(jobId: string, error: string): Promise<void> {
  const job = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  if (job.attempts < job.maxAttempts) {
    // Retry with exponential backoff: 30s, 60s, 120s, ...
    const backoffMs = Math.pow(2, job.attempts) * 30_000;
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: "retrying",
        error,
        nextRunAt: new Date(Date.now() + backoffMs),
      },
    });
    logger.job(job.type, `Job will retry in ${backoffMs / 1000}s: ${jobId}`, { error });
  } else {
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        error,
        completedAt: new Date(),
      },
    });

    // If recurring, still schedule the next regular run
    if (job.isRecurring && job.cronExpression) {
      const nextRun = getNextCronRun(job.cronExpression);
      await prisma.backgroundJob.update({
        where: { id: jobId },
        data: {
          status: "pending",
          nextRunAt: nextRun,
          startedAt: null,
          completedAt: null,
          result: undefined,
          attempts: 0,
        },
      });
    }

    logger.error(`Job failed permanently: ${jobId}`, { type: job.type, error });
  }
}

/**
 * Get job queue status summary.
 */
export async function getJobQueueStatus() {
  const [pending, running, failed, completed] = await Promise.all([
    prisma.backgroundJob.count({ where: { status: "pending" } }),
    prisma.backgroundJob.count({ where: { status: "running" } }),
    prisma.backgroundJob.count({ where: { status: "failed" } }),
    prisma.backgroundJob.count({ where: { status: "completed" } }),
  ]);

  const jobs = await prisma.backgroundJob.findMany({
    where: { isRecurring: true },
    orderBy: { type: "asc" },
    select: {
      id: true,
      type: true,
      status: true,
      cronExpression: true,
      lastRunAt: true,
      nextRunAt: true,
      attempts: true,
      error: true,
    },
  });

  return {
    summary: { pending, running, failed, completed },
    recurringJobs: jobs,
  };
}

/**
 * Simple cron expression parser — returns the next run time.
 * Supports: "* /N * * * *" (every N minutes), "N * * * *" (at minute N), "0 N * * *" (at hour N).
 */
function getNextCronRun(cron: string): Date {
  const parts = cron.split(" ");
  const now = new Date();
  const next = new Date(now);

  if (parts.length < 5) {
    // Default: 5 minutes from now
    next.setMinutes(next.getMinutes() + 5);
    return next;
  }

  const [minute, hour] = parts;

  // Every N minutes: */N * * * *
  if (minute.startsWith("*/")) {
    const interval = parseInt(minute.substring(2));
    next.setMinutes(next.getMinutes() + interval);
    next.setSeconds(0);
    next.setMilliseconds(0);
    return next;
  }

  // Every N hours at minute 0: 0 */N * * *
  if (minute === "0" && hour.startsWith("*/")) {
    const interval = parseInt(hour.substring(2));
    next.setHours(next.getHours() + interval);
    next.setMinutes(0);
    next.setSeconds(0);
    next.setMilliseconds(0);
    return next;
  }

  // Specific hour: 0 N * * *
  if (minute === "0" && !hour.includes("*")) {
    const targetHour = parseInt(hour);
    next.setHours(targetHour);
    next.setMinutes(0);
    next.setSeconds(0);
    next.setMilliseconds(0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  // Fallback: 5 minutes from now
  next.setMinutes(next.getMinutes() + 5);
  next.setSeconds(0);
  next.setMilliseconds(0);
  return next;
}
