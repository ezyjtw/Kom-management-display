import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-user";
import {
  getJobQueueStatus,
  registerDefaultJobs,
  enqueueJob,
  claimNextJob,
  completeJob,
  failJob,
  type JobType,
} from "@/lib/background-jobs";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

const VALID_JOB_TYPES: JobType[] = [
  "sync_slack", "sync_email", "sync_jira", "check_sla",
  "check_staking", "poll_komainu", "check_confirmations", "cleanup_sessions",
];

/**
 * GET /api/jobs
 * Get job queue status and recurring job list (admin/lead only).
 */
export async function GET() {
  const auth = await requireRole("admin", "lead");
  if (auth instanceof NextResponse) return auth;

  try {
    const status = await getJobQueueStatus();
    return apiSuccess(status);
  } catch (error) {
    return handleApiError(error, "jobs GET");
  }
}

/**
 * POST /api/jobs
 * Manage background jobs (admin only).
 * Body: { action: "register_defaults" | "enqueue" | "trigger" | "process_next", type?, payload? }
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const body = await request.json();
    const { action } = body;

    if (!action) {
      return apiValidationError("action is required");
    }

    switch (action) {
      case "register_defaults": {
        await registerDefaultJobs();
        return apiSuccess({ registered: true });
      }

      case "enqueue": {
        const { type, payload, runAt } = body;
        if (!type || !VALID_JOB_TYPES.includes(type)) {
          return apiValidationError(`type must be one of: ${VALID_JOB_TYPES.join(", ")}`);
        }
        const jobId = await enqueueJob(type, payload || {}, {
          runAt: runAt ? new Date(runAt) : undefined,
        });
        return apiSuccess({ jobId }, undefined, 201);
      }

      case "trigger": {
        // Manually trigger a recurring job to run now
        const { type } = body;
        if (!type) return apiValidationError("type is required");

        const job = await prisma.backgroundJob.findFirst({
          where: { type, isRecurring: true },
        });

        if (!job) return apiValidationError(`No recurring job found for type: ${type}`);

        await prisma.backgroundJob.update({
          where: { id: job.id },
          data: { nextRunAt: new Date(), status: "pending" },
        });

        return apiSuccess({ triggered: true, jobId: job.id });
      }

      case "process_next": {
        // Process the next available job (for worker mode)
        const job = await claimNextJob();
        if (!job) return apiSuccess({ processed: false, message: "No jobs available" });

        try {
          // Execute the job handler
          const result = await executeJobHandler(job.type, job.payload as Record<string, unknown>);
          await completeJob(job.id, result);
          return apiSuccess({ processed: true, jobId: job.id, result });
        } catch (error) {
          await failJob(job.id, error instanceof Error ? error.message : String(error));
          return apiSuccess({ processed: true, jobId: job.id, failed: true });
        }
      }

      default:
        return apiValidationError(`Unknown action: ${action}`);
    }
  } catch (error) {
    return handleApiError(error, "jobs POST");
  }
}

/**
 * Execute the appropriate handler for a job type.
 */
async function executeJobHandler(type: string, payload: Record<string, unknown>): Promise<unknown> {
  switch (type) {
    case "sync_slack": {
      const { syncSlackChannel } = await import("@/lib/integrations/slack");
      const channelId = (payload.channelId as string) || process.env.SLACK_OPS_CHANNEL_ID || "";
      if (!channelId) return { skipped: true, reason: "No channel ID configured" };
      return syncSlackChannel(channelId);
    }

    case "sync_email": {
      const { syncEmailInbox } = await import("@/lib/integrations/email");
      return syncEmailInbox();
    }

    case "sync_jira": {
      const { syncJiraProject } = await import("@/lib/integrations/jira");
      const projectKey = (payload.projectKey as string) || process.env.JIRA_PROJECT_KEY || "";
      if (!projectKey) return { skipped: true, reason: "No Jira project key configured" };
      return syncJiraProject(projectKey);
    }

    case "check_sla": {
      // Check for SLA breaches and generate alerts
      const breached = await prisma.commsThread.findMany({
        where: {
          status: { notIn: ["Done", "Closed"] },
          OR: [
            { ttoDeadline: { lt: new Date() } },
            { ttfaDeadline: { lt: new Date() } },
            { tslaDeadline: { lt: new Date() } },
          ],
        },
        select: { id: true, subject: true, ttoDeadline: true, ttfaDeadline: true, tslaDeadline: true },
      });
      return { breachedThreads: breached.length };
    }

    case "check_staking": {
      const overdue = await prisma.stakingWallet.findMany({
        where: {
          status: "active",
          expectedNextRewardAt: { lt: new Date() },
        },
        select: { id: true, asset: true, clientName: true },
      });
      return { overdueRewards: overdue.length };
    }

    case "poll_komainu": {
      try {
        const { isKomainuConfigured, fetchPendingTransactions } = await import("@/lib/integrations/komainu");
        if (!isKomainuConfigured()) return { skipped: true, reason: "Komainu not configured" };
        const result = await fetchPendingTransactions();
        return { transactionsPolled: result.data.length };
      } catch {
        return { skipped: true, reason: "Komainu API unavailable" };
      }
    }

    case "check_confirmations": {
      const { checkExpiredConfirmations } = await import("@/lib/transaction-confirmation");
      const expired = await checkExpiredConfirmations();
      return { expiredConfirmations: expired };
    }

    case "cleanup_sessions": {
      const { cleanupExpiredSessions } = await import("@/lib/session-revocation");
      const cleaned = await cleanupExpiredSessions();
      return { cleanedSessions: cleaned };
    }

    default:
      return { skipped: true, reason: `Unknown job type: ${type}` };
  }
}
