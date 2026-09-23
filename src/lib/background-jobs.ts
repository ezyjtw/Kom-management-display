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
 * - poll_custody: Poll Custody API for new transactions/requests
 * - check_confirmations: Check for expired transaction confirmations
 * - cleanup_sessions: Clean up expired session metadata
 *
 * Processed by the always-on worker (src/worker/index.ts).
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { CronExpressionParser } from "cron-parser";

export type JobType =
  | "sync_jira"
  | "check_sla"
  | "check_staking"
  | "check_confirmations"
  | "cleanup_sessions"
  | "sync_slack_channel"
  | "sync_slack_replies"
  | "slack_event"
  | "classify_thread"
  | "draft_client_comms"
  | "poll_status_pages"
  | "score_vendor_reliability"
  | "komainu_poll_requests"
  | "komainu_poll_transactions"
  | "komainu_poll_collateral"
  | "komainu_poll_audit_logs"
  | "komainu_poll_eod_balances"
  | "komainu_poll_staking"
  | "graph_mail_sync"
  | "graph_teams_sync"
  | "report_unticketed"
  | "reconcile_tickets"
  | "iai_overdue"
  | "evaluate_alerts"
  | "alert_digest"
  | "poll_risk_signals";

/** Recurring job types replaced in Phase 3; their stored rows are removed on registration. */
export const RETIRED_JOB_TYPES = ["sync_email", "poll_custody", "sync_slack"] as const;

/**
 * Job priority levels — lower number = higher priority.
 */
export enum JobPriority {
  CRITICAL = 0,
  HIGH = 1,
  NORMAL = 2,
  LOW = 3,
}

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
    { type: "sync_jira", cronExpression: "*/2 * * * *" },          // spec §8.2: every 2 min, updated >= -5m
    { type: "check_sla", cronExpression: "*/1 * * * *" },
    { type: "check_staking", cronExpression: "0 */6 * * *" },
    { type: "check_confirmations", cronExpression: "*/5 * * * *" },
    { type: "cleanup_sessions", cronExpression: "0 2 * * *" },
    { type: "sync_slack_channel", cronExpression: "*/5 * * * *" }, // spec §8.4: polling fallback to Events API
    { type: "komainu_poll_requests", cronExpression: "*/1 * * * *" },
    { type: "komainu_poll_transactions", cronExpression: "*/2 * * * *" },
    // Every 10 min; the per-window 60-second cadence comes with OesWindow in Phase 6.
    { type: "komainu_poll_collateral", cronExpression: "*/10 * * * *" },
    { type: "komainu_poll_audit_logs", cronExpression: "*/5 * * * *" },
    { type: "komainu_poll_eod_balances", cronExpression: "0 7 * * *" },
    { type: "komainu_poll_staking", cronExpression: "30 7 * * *" },
    { type: "graph_mail_sync", cronExpression: "*/3 * * * *" },
    { type: "graph_teams_sync", cronExpression: "*/5 * * * *" },
    { type: "poll_status_pages", cronExpression: "*/10 * * * *" },  // no-op unless module.status_pages
    { type: "report_unticketed", cronExpression: "TZ=Europe/London 30 8 * * *" }, // spec §10.3: 08:30 UK
    { type: "reconcile_tickets", cronExpression: "15 * * * *" },   // spec §10.3: hourly
    { type: "iai_overdue", cronExpression: "5 * * * *" },          // spec §10.4
    { type: "evaluate_alerts", cronExpression: "*/1 * * * *" },    // spec §11.1: every 60 s; rules may declare their own cadence
    { type: "alert_digest", cronExpression: "TZ=Europe/London 0 8 * * *" }, // spec §11.3: daily digest of medium config rules
    { type: "poll_risk_signals", cronExpression: "*/1 * * * *" },  // spec §11.4
  ];

  await prisma.backgroundJob.deleteMany({
    where: { type: { in: [...RETIRED_JOB_TYPES] }, isRecurring: true },
  });

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
          payload: (job.payload ?? {}) as Prisma.InputJsonValue,
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
  opts?: { runAt?: Date; maxAttempts?: number; deduplicationKey?: string; priority?: JobPriority },
): Promise<string> {
  // If a deduplication key is provided, skip if a pending/running job exists with the same key
  if (opts?.deduplicationKey) {
    const existing = await prisma.backgroundJob.findFirst({
      where: {
        type,
        status: { in: ["pending", "running", "retrying"] },
        deduplicationKey: opts.deduplicationKey,
      },
    });
    if (existing) {
      logger.job(type, `Job deduplicated (key=${opts.deduplicationKey}): ${existing.id}`);
      return existing.id;
    }
  }

  const job = await prisma.backgroundJob.create({
    data: {
      type,
      payload: payload as Prisma.InputJsonValue,
      nextRunAt: opts?.runAt ?? new Date(),
      maxAttempts: opts?.maxAttempts ?? 3,
      isRecurring: false,
      priority: opts?.priority ?? JobPriority.NORMAL,
      ...(opts?.deduplicationKey ? { deduplicationKey: opts.deduplicationKey } : {}),
    },
  });

  logger.job(type, `Job enqueued: ${job.id}`);
  return job.id;
}

/** A job still "running" after this long is assumed orphaned by a dead worker. */
export const STALE_RUNNING_MS = 15 * 60_000;

/**
 * Return orphaned "running" jobs to the queue so a crashed worker cannot
 * block a recurring job forever. Returns the number recovered.
 */
export async function recoverStaleJobs(now = new Date()): Promise<number> {
  const { count } = await prisma.backgroundJob.updateMany({
    where: {
      status: "running",
      type: { not: "worker_heartbeat" },
      startedAt: { lt: new Date(now.getTime() - STALE_RUNNING_MS) },
    },
    data: { status: "retrying", nextRunAt: now, error: "Recovered: worker stopped mid-run" },
  });
  if (count > 0) logger.warn("Recovered stale running jobs", { count });
  return count;
}

/**
 * Fetch and lock the next due job. Uses a conditional update to prevent
 * double-processing. A recurring job is skipped (and rescheduled) while a
 * previous run of the same type is still running, so runs never overlap.
 */
export async function claimNextJob(): Promise<{
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
} | null> {
  const now = new Date();
  // Priority 0=critical … 3=low, then oldest first.
  const candidates = await prisma.backgroundJob.findMany({
    where: {
      status: { in: ["pending", "retrying"] },
      nextRunAt: { lte: now },
      deadLetteredAt: null,
    },
    orderBy: [{ priority: "asc" }, { nextRunAt: "asc" }],
    take: 10,
  });

  for (const job of candidates) {
    if (job.isRecurring) {
      const overlapping = await prisma.backgroundJob.count({
        where: { type: job.type, status: "running", id: { not: job.id } },
      });
      if (overlapping > 0) {
        await prisma.backgroundJob.updateMany({
          where: { id: job.id, status: job.status },
          data: { nextRunAt: getNextCronRun(job.cronExpression ?? "", now) },
        });
        logger.job(job.type, "Skipped recurring run: previous run still in progress");
        continue;
      }
    }

    const claimed = await prisma.backgroundJob.updateMany({
      where: { id: job.id, status: job.status },
      data: { status: "running", startedAt: now, attempts: job.attempts + 1 },
    });
    if (claimed.count === 0) continue; // another worker got it

    return { id: job.id, type: job.type, payload: job.payload, attempts: job.attempts + 1 };
  }

  return null;
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
    // Move to dead letter queue — preserve the job for inspection
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        error,
        completedAt: new Date(),
        deadLetteredAt: new Date(),
        deadLetterReason: `Exhausted ${job.maxAttempts} attempts. Last error: ${error}`,
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
          deadLetteredAt: null,
          deadLetterReason: "",
        },
      });
    }

    logger.error(`Job dead-lettered: ${jobId}`, { type: job.type, error });
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
 * Worker heartbeat — call periodically from the job-processing loop
 * so that other instances (and the health endpoint) can detect stale workers.
 *
 * Stores the heartbeat as a BackgroundJob metadata row with type 'worker_heartbeat'.
 * The `lastRunAt` column is bumped on every tick.
 */
export async function workerHeartbeat(workerId: string): Promise<void> {
  try {
    const existing = await prisma.backgroundJob.findFirst({
      where: { type: "worker_heartbeat", deduplicationKey: `heartbeat:${workerId}` },
    });

    if (existing) {
      await prisma.backgroundJob.update({
        where: { id: existing.id },
        data: { lastRunAt: new Date(), status: "running" },
      });
    } else {
      await prisma.backgroundJob.create({
        data: {
          type: "worker_heartbeat",
          deduplicationKey: `heartbeat:${workerId}`,
          status: "running",
          isRecurring: false,
          payload: { workerId } as Prisma.InputJsonValue,
          lastRunAt: new Date(),
          nextRunAt: new Date(),
        },
      });
    }
  } catch (error) {
    logger.warn("Failed to update worker heartbeat", {
      workerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Check if any worker has sent a heartbeat within the given threshold.
 * Returns true if at least one worker is alive.
 */
export async function isAnyWorkerAlive(thresholdMs = 120_000): Promise<boolean> {
  const cutoff = new Date(Date.now() - thresholdMs);
  const alive = await prisma.backgroundJob.count({
    where: {
      type: "worker_heartbeat",
      lastRunAt: { gte: cutoff },
    },
  });
  return alive > 0;
}

/**
 * Get dead-lettered jobs for review/replay.
 */
export async function getDeadLetterJobs(limit = 50) {
  return prisma.backgroundJob.findMany({
    where: {
      deadLetteredAt: { not: null },
    },
    orderBy: { deadLetteredAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      status: true,
      payload: true,
      error: true,
      attempts: true,
      maxAttempts: true,
      priority: true,
      deduplicationKey: true,
      deadLetteredAt: true,
      deadLetterReason: true,
      createdAt: true,
    },
  });
}

/**
 * Replay a dead-lettered job — resets it for re-processing.
 */
export async function replayDeadLetterJob(jobId: string): Promise<void> {
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: "pending",
      attempts: 0,
      error: "",
      nextRunAt: new Date(),
      startedAt: null,
      completedAt: null,
      deadLetteredAt: null,
      deadLetterReason: "",
    },
  });
  logger.info(`Dead-letter job replayed: ${jobId}`);
}

/**
 * Next run time for a 5-field cron expression, evaluated in UTC.
 * An invalid expression falls back to five minutes from now so the job
 * keeps running instead of stalling; the error is logged.
 */
/** Cron in UTC, or in a named zone with a `TZ=<zone> ` prefix (e.g. "TZ=Europe/London 30 8 * * *"). */
export function getNextCronRun(cron: string, from: Date = new Date()): Date {
  try {
    const m = /^TZ=(\S+)\s+(.+)$/.exec(cron.trim());
    const [tz, expr] = m ? [m[1], m[2]] : ["UTC", cron];
    return CronExpressionParser.parse(expr, { currentDate: from, tz }).next().toDate();
  } catch (error) {
    logger.error("Invalid cron expression", {
      cron,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Date(from.getTime() + 5 * 60_000);
  }
}
