/**
 * GET /api/integrations/health
 *
 * Returns health status for all configured integrations.
 * Admin-only endpoint for the integrations dashboard.
 *
 * Health state is derived from Postgres (BackgroundJob table) rather than
 * in-memory maps, so it is accurate across multiple instances.
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { apiSuccess } from "@/lib/api/response";
import { isAnyWorkerAlive } from "@/lib/background-jobs";
import { getEnv, type Env } from "@/lib/env";

/** Map integration source names to the BackgroundJob types that sync them. */
const SOURCE_JOB_TYPE: Record<string, string> = {
  jira: "sync_jira",
  confluence: "sync_confluence",
  slack: "sync_slack",
  email: "sync_email",
  fireblocks: "check_staking",
  custody: "poll_custody",
  notabene: "check_confirmations",
};

export async function GET() {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  const sources = ["jira", "confluence", "slack", "email", "fireblocks", "custody", "notabene"] as const;
  const envChecks: Record<string, string[]> = {
    jira: ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"],
    confluence: ["CONFLUENCE_BASE_URL", "CONFLUENCE_EMAIL", "CONFLUENCE_API_TOKEN"],
    slack: ["SLACK_BOT_TOKEN"],
    email: ["IMAP_HOST", "IMAP_USER", "IMAP_PASSWORD"],
    fireblocks: ["FIREBLOCKS_API_KEY"],
    custody: ["CUSTODY_API_SECRET"],
    notabene: ["NOTABENE_API_TOKEN"],
  };

  // Fetch the latest recurring job row for each integration in one query
  const jobTypes = Object.values(SOURCE_JOB_TYPE);
  const jobs = await prisma.backgroundJob.findMany({
    where: { type: { in: jobTypes }, isRecurring: true },
    select: {
      type: true,
      status: true,
      lastRunAt: true,
      error: true,
      attempts: true,
    },
  });
  const jobByType = new Map(jobs.map((j) => [j.type, j]));

  const workerAlive = await isAnyWorkerAlive();

  const integrations = sources.map((source) => {
    const validatedEnv = getEnv();
    const configured = envChecks[source]?.every((v) => !!validatedEnv[v as keyof Env]) ?? false;
    const jobType = SOURCE_JOB_TYPE[source];
    const job = jobType ? jobByType.get(jobType) : undefined;

    let status: "healthy" | "degraded" | "down" | "unconfigured" = "unconfigured";
    if (configured) {
      if (!workerAlive) {
        status = "down";
      } else if (job?.status === "failed" || (job?.error && job.error.length > 0)) {
        status = "degraded";
      } else {
        status = "healthy";
      }
    }

    return {
      source,
      configured,
      lastSuccessfulSync: job?.lastRunAt ?? null,
      lastFailure: job?.error && job.error.length > 0 ? job.error : null,
      queueBacklog: 0,
      failureCount: job?.attempts ?? 0,
      status,
    };
  });

  return apiSuccess(integrations, { timestamp: new Date().toISOString(), workerAlive });
}
