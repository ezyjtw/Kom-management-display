/**
 * GET /api/health/liveness
 *
 * Simple liveness probe — confirms the app is running.
 * No external dependencies checked.
 */
import { apiSuccess } from "@/lib/api/response";

export async function GET() {
  return apiSuccess({ status: "alive", timestamp: new Date().toISOString() });
}
