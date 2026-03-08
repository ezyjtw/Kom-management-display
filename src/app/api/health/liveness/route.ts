/**
 * GET /api/health/liveness
 *
 * Simple liveness probe — confirms the app is running.
 * No external dependencies checked.
 */
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ status: "alive", timestamp: new Date().toISOString() });
}
