/**
 * POST /api/admin/jira-projects/:key/discover — read the project's issue types
 * from Jira (GET createmeta) and store name -> id. Keeps the chosen `_default`.
 */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiNotFoundError, apiSuccess, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { discoverIssueTypes, isAtlassianConfigured } from "@/lib/integrations/atlassian/client";

export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "app_setting", "configure");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const { key } = await params;
    const project = await prisma.jiraProjectConfig.findUnique({ where: { key } });
    if (!project) return apiNotFoundError("Jira project");
    if (!isAtlassianConfigured()) return NextResponse.json({ success: false, error: "Atlassian is not configured." }, { status: 409 });

    const discovered = await discoverIssueTypes(key);
    const current = (project.issueTypeIds ?? {}) as Record<string, string>;
    const keepDefault = current._default && Object.values(discovered).includes(current._default) ? { _default: current._default } : {};
    const updated = await prisma.jiraProjectConfig.update({
      where: { key },
      data: { issueTypeIds: { ...discovered, ...keepDefault } as Prisma.InputJsonValue },
    });
    return apiSuccess(updated);
  } catch (error) {
    return handleApiError(error, "admin jira-project discover");
  }
}
