import { NextRequest, NextResponse } from "next/server";
import { syncJiraProject } from "@/lib/integrations/jira";
import { requireRole } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { z } from "zod";
import { env } from "@/lib/env";

/**
 * POST /api/integrations/jira
 * Trigger a sync of a Jira project. Admin only.
 *
 * Body: { projectKey: string, queue?: string, jql?: string }
 */
export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "thread", "view");
  if (authz instanceof NextResponse) return authz;

  try {
    const body = await request.json();
    const _parsed = z.object({}).passthrough().safeParse(body);
    if (!_parsed.success) return apiValidationError(_parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
    const { projectKey, queue, jql } = body;

    if (!projectKey) {
      return apiValidationError("projectKey is required");
    }

    const result = await syncJiraProject(projectKey, queue, jql);

    // Audit: log integration sync
    await prisma.auditLog.create({
      data: {
        action: "integration_sync",
        entityType: "jira_project",
        entityId: projectKey,
        userId: auth.employeeId || auth.id,
        details: JSON.stringify({
          projectKey,
          queue: queue || "Transaction Operations",
          threadsSynced: result.threadsSynced,
          totalIssues: result.totalIssues,
        }),
      },
    });

    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error, "jira sync");
  }
}

/**
 * GET /api/integrations/jira
 * Get current Jira integration status. Admin only.
 */
export async function GET() {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  const configured =
    !!env("JIRA_BASE_URL") &&
    !!env("JIRA_EMAIL") &&
    !!env("JIRA_API_TOKEN");

  return apiSuccess({
    configured,
    baseUrl: configured ? env("JIRA_BASE_URL") : null,
  });
}
