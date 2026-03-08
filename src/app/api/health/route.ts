import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/api/response";

export async function GET() {
  const start = Date.now();

  const health: {
    status: string;
    database: string;
    databaseLatencyMs: number;
    timestamp: string;
    version: string;
    environment: string;
    uptime: number;
  } = {
    status: "ok",
    database: "unknown",
    databaseLatencyMs: 0,
    timestamp: new Date().toISOString(),
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || "dev",
    environment: process.env.NODE_ENV || "development",
    uptime: process.uptime(),
  };

  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    health.databaseLatencyMs = Date.now() - dbStart;
    health.database = "connected";
  } catch {
    health.status = "degraded";
    health.database = "unreachable";
    health.databaseLatencyMs = Date.now() - start;
  }

  if (health.status === "ok") {
    return apiSuccess(health);
  }
  return apiError("Service degraded", 503);
}
