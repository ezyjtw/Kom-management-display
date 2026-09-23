import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, handleApiError } from "@/lib/api/response";

/** GET /api/admin/alert-rules — rule configuration (the catalogue is seeded in Phase 6). */
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "alert_rule", "view");
  if (authz instanceof NextResponse) return authz;

  try {
    return apiSuccess(await prisma.alertRule.findMany({ orderBy: { code: "asc" } }));
  } catch (error) {
    return handleApiError(error, "admin alert-rules GET");
  }
}
