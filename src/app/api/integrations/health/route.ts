/**
 * GET /api/integrations/health
 *
 * Health of every connector, derived from SourceHeartbeat (so it is accurate
 * across the web and worker processes). Admin only.
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-user";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { isAnyWorkerAlive } from "@/lib/background-jobs";
import { getAllHealth } from "@/modules/integrations/registry";

export async function GET() {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  try {
    const [integrations, workerAlive] = await Promise.all([getAllHealth(), isAnyWorkerAlive()]);
    return apiSuccess(integrations, { timestamp: new Date().toISOString(), workerAlive });
  } catch (error) {
    return handleApiError(error, "integrations health");
  }
}
