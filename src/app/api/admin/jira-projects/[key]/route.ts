/**
 * PATCH /api/admin/jira-projects/:key — enable a project for ticket creation,
 * pick its default issue type (from discovered types) and inbound sync.
 * Changes KOMmand Centre's routing only, never Jira configuration. Audit-logged.
 */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { auditedAction } from "@/lib/api/audit";
import { apiNotFoundError, apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { updateJiraProjectSchema, validateBody } from "@/lib/validation";
import { auditActor } from "@/modules/core-data/audit-actor";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "app_setting", "configure");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const { key } = await params;
    const parsed = validateBody(updateJiraProjectSchema, await request.json());
    if (!parsed.success) return apiValidationError(parsed.error);
    const before = await prisma.jiraProjectConfig.findUnique({ where: { key } });
    if (!before) return apiNotFoundError("Jira project");

    const { defaultIssueType, ...rest } = parsed.data;
    const types = { ...((before.issueTypeIds ?? {}) as Record<string, string>) };
    if (defaultIssueType !== undefined) {
      if (!types[defaultIssueType]) {
        return NextResponse.json({ success: false, error: `Unknown issue type "${defaultIssueType}". Discover issue types first.` }, { status: 422 });
      }
      types._default = types[defaultIssueType];
    }

    const actor = auditActor(auth);
    const updated = await auditedAction(
      {
        action: "jira_project_updated",
        entityType: "jira_project",
        entityId: key,
        userId: actor.userId,
        summary: `Update Jira project ${key} routing`,
        before: { enabled: before.enabled, syncInbound: before.syncInbound, issueTypeIds: before.issueTypeIds, serviceDeskId: before.serviceDeskId },
        metadata: actor.metadata,
      },
      async () => prisma.jiraProjectConfig.update({
        where: { key },
        data: { ...rest, ...(defaultIssueType !== undefined ? { issueTypeIds: types as Prisma.InputJsonValue } : {}) },
      }),
      (r) => ({ enabled: r.enabled, syncInbound: r.syncInbound, issueTypeIds: r.issueTypeIds, serviceDeskId: r.serviceDeskId }),
    );
    return apiSuccess(updated);
  } catch (error) {
    return handleApiError(error, "admin jira-project PATCH");
  }
}
