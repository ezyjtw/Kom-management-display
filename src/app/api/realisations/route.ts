/**
 * GET /api/realisations — RLS cases (RLS) for CHK-09K. Requires realisation:view: admins and
 * the named users in realisation.viewerUserIds, mirroring the RESTRICTED explainer.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { apiForbiddenError, apiSuccess, handleApiError } from "@/lib/api/response";
import { canViewRealisations, REALISATION_NOTICE } from "@/modules/realisations/access";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  if (!(await canViewRealisations(auth))) return apiForbiddenError("Requires realisation:view");
  try {
    const cases = await prisma.workItem.findMany({
      where: { OR: [{ kind: "realisation_case" }, { ticketKey: { startsWith: "RLS-" } }] },
      orderBy: { clockStartedAt: "desc" },
      take: 200,
      select: { id: true, title: true, ticketKey: true, ticketUrl: true, state: true, exposureUsd: true, clockStartedAt: true, ownerEmployeeId: true },
    });
    const alerts = await prisma.alert.findMany({ where: { ruleCode: "ALR-RLS-01", status: { not: "resolved" } }, select: { workItemId: true, message: true } });
    const flagged = new Set(alerts.map((a) => a.workItemId));
    return apiSuccess({ cases: cases.map((c) => ({ ...c, riskCommitteeThresholdAlert: flagged.has(c.id) })), notice: REALISATION_NOTICE });
  } catch (error) {
    return handleApiError(error, "realisations GET");
  }
}
