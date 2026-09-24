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
import { getAllHealth, getHealthSummary } from "@/modules/integrations/registry";
import { CircuitBreaker } from "@/lib/circuit-breaker";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = checkAuthorization(auth, "metrics", "view");
  if (!authz.allowed) return apiForbiddenError(authz.reason);

  try {
    const integrations = await getAllHealth();
    const summary = await getHealthSummary();
    const breakers = CircuitBreaker.getAllStatus();
    const byConnector: Record<string, string> = { custody_api: "custody_api", atlassian: "atlassian", slack: "slack_channel_sync", graph_mail: "graph", graph_teams: "graph", notabene: "notabene" };

    const dependencies = integrations.map((h) => {
      const breaker = breakers[byConnector[h.source]];
      return {
        ...h,
        stale: h.heartbeats.some((b) => b.stale),
        // Breaker state is per process; the worker's breakers are not visible here.
        circuitBreaker: breaker
          ? { state: breaker.state, totalCalls: breaker.totalCalls, totalFailures: breaker.totalFailures }
          : null,
      };
    });

    return apiSuccess({
      summary,
      staleCount: dependencies.filter((d) => d.stale).length,
      dependencies,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return handleApiError(error, "GET /api/health/dependencies");
  }
}
