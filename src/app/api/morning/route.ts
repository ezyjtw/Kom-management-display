/** GET /api/morning — the morning board (spec §14.3). Built only from tickets and WorkItems. */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { prisma } from "@/lib/prisma";
import { buildMorningBoard } from "@/modules/morning/board";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "view");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.read);
  if (limited) return limited;
  try {
    const [board, people] = await Promise.all([
      buildMorningBoard(),
      prisma.employee.findMany({ where: { active: true, id: { not: "system" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ]);
    return apiSuccess({ ...board, people, me: { employeeId: auth.employeeId ?? null, role: auth.role } });
  } catch (error) {
    return handleApiError(error, "morning board GET");
  }
}
