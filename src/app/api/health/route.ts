import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess } from "@/lib/api/response";
import { CircuitBreaker } from "@/lib/circuit-breaker";
import { getIdempotencyStats } from "@/lib/idempotency";

interface ComponentHealth {
  status: "healthy" | "degraded" | "unhealthy";
  latencyMs?: number;
  details?: string;
}

/**
 * GET /api/health
 *
 * Returns system health with optional deep checks.
 * - Basic (default): DB connectivity only
 * - Deep (?deep=true): DB, job queue, circuit breakers, memory, event loop
 */
export async function GET(request: NextRequest) {
  const start = Date.now();
  const deep = request.nextUrl.searchParams.get("deep") === "true";

  const components: Record<string, ComponentHealth> = {};
  let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";

  // ─── Database ───
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbLatency = Date.now() - dbStart;
    components.database = {
      status: dbLatency > 1000 ? "degraded" : "healthy",
      latencyMs: dbLatency,
    };
    if (dbLatency > 1000) overallStatus = "degraded";
  } catch (error) {
    components.database = {
      status: "unhealthy",
      details: error instanceof Error ? error.message : "Connection failed",
    };
    overallStatus = "unhealthy";
  }

  // ─── Deep checks (gated to prevent abuse on public endpoint) ───
  if (deep) {
    // Job queue status
    try {
      const dbStart = Date.now();
      const [pending, failed] = await Promise.all([
        prisma.backgroundJob.count({ where: { status: "pending" } }),
        prisma.backgroundJob.count({
          where: { status: "failed", updatedAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
        }),
      ]);
      const latency = Date.now() - dbStart;

      components.jobQueue = {
        status: failed > 10 ? "degraded" : "healthy",
        latencyMs: latency,
        details: `${pending} pending, ${failed} failed (last hour)`,
      };
      if (failed > 10) overallStatus = "degraded";
    } catch {
      components.jobQueue = { status: "unhealthy", details: "Query failed" };
      if (overallStatus !== "unhealthy") overallStatus = "degraded";
    }

    // Circuit breakers
    const breakerStatuses = CircuitBreaker.getAllStatus();
    const openBreakers = Object.values(breakerStatuses).filter(
      (b) => b.state === "open",
    );
    components.circuitBreakers = {
      status: openBreakers.length > 0 ? "degraded" : "healthy",
      details: `${Object.keys(breakerStatuses).length} registered, ${openBreakers.length} open`,
    };
    if (openBreakers.length > 0 && overallStatus === "healthy") {
      overallStatus = "degraded";
    }

    // Memory usage
    const mem = process.memoryUsage();
    const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    components.memory = {
      status: heapUsedMB > 512 ? "degraded" : "healthy",
      details: `heap ${heapUsedMB}/${heapTotalMB}MB, rss ${rssMB}MB`,
    };

    // Idempotency cache
    const idempotencyStats = getIdempotencyStats();
    components.idempotencyCache = {
      status: idempotencyStats.processingCount > 50 ? "degraded" : "healthy",
      details: `${idempotencyStats.totalEntries} entries, ${idempotencyStats.processingCount} processing`,
    };
  }

  const health = {
    status: overallStatus,
    components,
    timestamp: new Date().toISOString(),
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || "dev",
    environment: process.env.NODE_ENV || "development",
    uptime: Math.round(process.uptime()),
    responseTimeMs: Date.now() - start,
  };

  const statusCode = overallStatus === "unhealthy" ? 503 : overallStatus === "degraded" ? 200 : 200;
  return apiSuccess(health, undefined, statusCode);
}
