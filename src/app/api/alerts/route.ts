/**
 * GET /api/alerts?status=active|acknowledged|resolved|all — alerting-engine
 * alerts (spec §14.1 "Alerts"): by severity, with rule code, fire count, the
 * linked WorkItem and its ticket.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

const querySchema = z.object({ status: z.enum(["active", "acknowledged", "resolved", "all"]).default("active") });
const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "alert", "view");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.read);
  if (limited) return limited;
  try {
    const parsed = validateBody(querySchema, Object.fromEntries(new URL(request.url).searchParams.entries()));
    if (!parsed.success) return apiValidationError(parsed.error);
    const { status } = parsed.data;
    const alerts = await prisma.alert.findMany({
      where: { ruleCode: { startsWith: "ALR-" }, ...(status === "all" ? {} : { status }) },
      orderBy: { lastFiredAt: "desc" },
      take: 500,
      select: {
        id: true, ruleCode: true, severity: true, status: true, message: true, fireCount: true, firstFiredAt: true, lastFiredAt: true,
        acknowledgedAt: true, workItemId: true, workItem: { select: { id: true, title: true, ticketKey: true, ticketUrl: true } },
      },
    });
    alerts.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
    return apiSuccess({ alerts, asOf: new Date().toISOString() });
  } catch (error) {
    return handleApiError(error, "alerts GET");
  }
}
