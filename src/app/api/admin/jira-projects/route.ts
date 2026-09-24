/** GET /api/admin/jira-projects — local Jira/JSM project routing (spec §8.3). Admin only. */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, handleApiError } from "@/lib/api/response";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "app_setting", "configure");
  if (authz instanceof NextResponse) return authz;
  try {
    return apiSuccess(await prisma.jiraProjectConfig.findMany({ orderBy: { key: "asc" } }));
  } catch (error) {
    return handleApiError(error, "admin jira-projects GET");
  }
}
