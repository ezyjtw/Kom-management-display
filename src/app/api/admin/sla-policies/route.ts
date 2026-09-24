import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { hasTargets } from "@/modules/core-data/sla-policy";

/** GET /api/admin/sla-policies — all policies plus which still have no targets (CONFIRM-SLA-TARGETS). */
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "sla_policy", "view");
  if (authz instanceof NextResponse) return authz;

  try {
    const policies = await prisma.slaPolicy.findMany({ orderBy: { code: "asc" } });
    const targetsNotSet = policies.filter((p) => p.isActive && !hasTargets(p)).map((p) => p.code);
    return apiSuccess({ policies, targetsNotSet });
  } catch (error) {
    return handleApiError(error, "admin sla-policies GET");
  }
}
