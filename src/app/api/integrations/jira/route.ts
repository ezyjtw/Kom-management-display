import { NextRequest, NextResponse } from "next/server";
import { syncJiraProject } from "@/lib/integrations/jira";
import { requireRole, safeErrorMessage } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/integrations/jira
 * Trigger a sync of a Jira project. Admin only.
 *
 * Body: { projectKey: string, queue?: string, jql?: string }
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { projectKey, queue, jql } = body;

    if (!projectKey) {
      return NextResponse.json(
        { success: false, error: "projectKey is required" },
        { status: 400 },
      );
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
          queue: queue || "Ops",
          threadsSynced: result.threadsSynced,
          totalIssues: result.totalIssues,
        }),
      },
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
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
    !!process.env.JIRA_BASE_URL &&
    !!process.env.JIRA_EMAIL &&
    !!process.env.JIRA_API_TOKEN;

  return NextResponse.json({
    success: true,
    data: {
      configured,
      baseUrl: configured ? process.env.JIRA_BASE_URL : null,
    },
  });
}
