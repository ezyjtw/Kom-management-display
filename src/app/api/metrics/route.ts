import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-user";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { metrics } from "@/lib/metrics";
import { CircuitBreaker } from "@/lib/circuit-breaker";

/**
 * GET /api/metrics
 *
 * Returns application metrics snapshot. Admin only.
 * Includes API counters, histograms, circuit breaker states,
 * and runtime diagnostics.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireRole("admin");
    if (auth instanceof NextResponse) return auth;

    const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.read, auth.id);
    if (limited) return limited;

    const mem = process.memoryUsage();

    const snapshot = {
      metrics: metrics.getSnapshot(),
      circuitBreakers: CircuitBreaker.getAllStatus(),
      runtime: {
        uptimeSeconds: Math.round(process.uptime()),
        memoryMB: {
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
          rss: Math.round(mem.rss / 1024 / 1024),
          external: Math.round(mem.external / 1024 / 1024),
        },
        nodeVersion: process.version,
        platform: process.platform,
      },
      collectedAt: new Date().toISOString(),
    };

    return apiSuccess(snapshot);
  } catch (error) {
    return handleApiError(error, "metrics");
  }
}
