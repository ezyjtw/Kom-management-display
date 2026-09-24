/**
 * GET /api/kps — KPS cases (KPR) for CHK-09K. Requires kps:view: admins and
 * the named users in kps.viewerUserIds, mirroring the RESTRICTED explainer.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { apiForbiddenError, apiSuccess, handleApiError } from "@/lib/api/response";
import { canViewKps, CF03_NOTICE } from "@/modules/kps/access";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  if (!(await canViewKps(auth))) return apiForbiddenError("Requires kps:view");
  try {
    const cases = await prisma.workItem.findMany({
      where: { OR: [{ kind: "kps_case" }, { ticketKey: { startsWith: "KPR-" } }] },
      orderBy: { clockStartedAt: "desc" },
      take: 200,
      select: { id: true, title: true, ticketKey: true, ticketUrl: true, state: true, exposureUsd: true, clockStartedAt: true, ownerEmployeeId: true },
    });
    const alerts = await prisma.alert.findMany({ where: { ruleCode: "ALR-KPS-01", status: { not: "resolved" } }, select: { workItemId: true, message: true } });
    const flagged = new Set(alerts.map((a) => a.workItemId));
    return apiSuccess({ cases: cases.map((c) => ({ ...c, riskcoThresholdAlert: flagged.has(c.id) })), notice: CF03_NOTICE });
  } catch (error) {
    return handleApiError(error, "kps GET");
  }
}
