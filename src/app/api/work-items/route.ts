/**
 * GET /api/work-items — the unified work queue (spec §14.1). Filters: team
 * (mine by default), kind, clientId, priority, sla, project, owner, status
 * (open by default), q. Ordered by SLA time remaining.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/validation";
import { listQueue, queueFilterSchema } from "@/modules/work-items/queue";
import { clientScopeFor, clientTableWhere } from "@/modules/auth/client-scope";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "view");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.read);
  if (limited) return limited;
  try {
    const raw = Object.fromEntries([...new URL(request.url).searchParams.entries()].filter(([, v]) => v !== ""));
    const parsed = validateBody(queueFilterSchema, raw);
    if (!parsed.success) return apiValidationError(parsed.error);
    const scope = await clientScopeFor(auth);
    const [result, clients] = await Promise.all([
      listQueue(parsed.data, { employeeId: auth.employeeId ?? null, scope }),
      prisma.client.findMany({ where: { isActive: true, ...clientTableWhere(scope) }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true } }),
    ]);
    return apiSuccess({ ...result, filter: parsed.data, clientOptions: clients.map((c) => ({ id: c.id, name: c.displayName })), asOf: new Date().toISOString() });
  } catch (error) {
    return handleApiError(error, "work queue GET");
  }
}
