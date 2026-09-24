import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import {
  getJobQueueStatus,
  registerDefaultJobs,
  enqueueJob,
  claimNextJob,
  completeJob,
  failJob,
} from "@/lib/background-jobs";
import { dispatchJob } from "@/worker/dispatch";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody, jobsPostSchema } from "@/lib/validation";
import { auditedResponse } from "@/lib/api/audit";
import { auditActor } from "@/modules/core-data/audit-actor";

/**
 * GET /api/jobs
 * Get job queue status and recurring job list (admin/lead only).
 */
export async function GET() {
  const auth = await requireRole("admin", "lead");
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "background_job", "view");
  if (authz instanceof NextResponse) return authz;

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
    const parsed = validateBody(jobsPostSchema, await request.json());
    if (!parsed.success) return apiValidationError(parsed.error);
    const body = parsed.data;

    const actor = auditActor(auth);
    // Job control is administration: fail-closed audit (spec §17.7).
    return await auditedResponse(
      { action: `job_${body.action}`, entityType: "background_job", entityId: "type" in body && body.type ? String(body.type) : body.action, userId: actor.userId, summary: `Background job action: ${body.action}`, metadata: actor.metadata },
      async () => {
      switch (body.action) {
        case "register_defaults": {
          await registerDefaultJobs();
          return apiSuccess({ registered: true });
        }

        case "enqueue": {
          const jobId = await enqueueJob(body.type, body.payload, {
            runAt: body.runAt ? new Date(body.runAt) : undefined,
          });
          return apiSuccess({ jobId }, undefined, 201);
        }

        case "trigger": {
          const { type } = body;
          const job = await prisma.backgroundJob.findFirst({
            where: { type, isRecurring: true },
          });

          if (!job) return apiValidationError(`No recurring job found for type: ${type}`);
          if (job.status === "running") return apiValidationError(`${type} is already running`);

          await prisma.backgroundJob.update({
            where: { id: job.id },
            data: { nextRunAt: new Date(), status: "pending" },
          });

          return apiSuccess({ triggered: true, jobId: job.id });
        }

        case "process_next": {
          // Manual one-off run; the always-on worker normally does this.
          const job = await claimNextJob();
          if (!job) return apiSuccess({ processed: false, message: "No jobs available" });

          try {
            const result = await dispatchJob(job.type, job.payload);
            await completeJob(job.id, result);
            return apiSuccess({ processed: true, jobId: job.id, result });
          } catch (error) {
            await failJob(job.id, error instanceof Error ? error.message : String(error));
            return apiSuccess({ processed: true, jobId: job.id, failed: true });
          }
        }
      }
      },
    );
  } catch (error) {
    return handleApiError(error, "jobs POST");
  }
}
