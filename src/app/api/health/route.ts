import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const health: {
    status: string;
    database: string;
    timestamp: string;
    version: string;
  } = {
    status: "ok",
    database: "unknown",
    timestamp: new Date().toISOString(),
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || "dev",
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    health.database = "connected";
  } catch {
    health.status = "degraded";
    health.database = "unreachable";
  }

  const statusCode = health.status === "ok" ? 200 : 503;
  return NextResponse.json(health, { status: statusCode });
}
