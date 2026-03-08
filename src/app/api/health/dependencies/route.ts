/**
 * GET /api/health/dependencies
 *
 * Reports health and freshness of all external integration dependencies.
 * Useful for admin dashboards and monitoring systems.
 * Requires admin or lead role.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { checkAuthorization } from "@/modules/auth/services/authorization";
import { apiForbiddenError, apiSuccess, handleApiError } from "@/lib/api/response";
import { getAllHealth, getStaleIntegrations, getHealthSummary } from "@/modules/integrations/registry";
import { CircuitBreaker } from "@/lib/circuit-breaker";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = checkAuthorization(auth, "metrics", "view");
  if (!authz.allowed) return apiForbiddenError(authz.reason);

  try {
    const integrations = getAllHealth();
    const stale = getStaleIntegrations();
    const summary = getHealthSummary();
    const breakers = CircuitBreaker.getAllStatus();

    const dependencies = integrations.map((h) => {
      const breaker = breakers[h.source];
      const staleSinceMs = h.lastSuccessfulSync
        ? Date.now() - h.lastSuccessfulSync.getTime()
        : null;

      return {
        source: h.source,
        configured: h.configured,
        status: h.status,
        lastSuccessfulSync: h.lastSuccessfulSync?.toISOString() ?? null,
        lastFailure: h.lastFailure?.toISOString() ?? null,
        lastFailureMessage: h.lastFailureMessage ?? null,
        staleSinceMs,
        stale: stale.some((s) => s.source === h.source),
        queueBacklog: h.queueBacklog,
        rateLimitRemaining: h.rateLimitRemaining ?? null,
        failureCount: h.failureCount,
        circuitBreaker: breaker
          ? { state: breaker.state, totalCalls: breaker.totalCalls, totalFailures: breaker.totalFailures }
          : null,
      };
    });

    return apiSuccess({
      summary,
      staleCount: stale.length,
      dependencies,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return handleApiError(error, "GET /api/health/dependencies");
  }
}
