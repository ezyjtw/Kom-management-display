import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { globalSearch } from "@/lib/global-search";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";

/**
 * GET /api/search?q=query&limit=50&modules=comms,incidents
 * Global search across all operational modules.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");
    const limit = parseInt(searchParams.get("limit") || "50");
    const modulesParam = searchParams.get("modules");

    if (!q || q.trim().length < 2) {
      return apiValidationError("Query parameter 'q' is required (minimum 2 characters)");
    }

    const modules = modulesParam ? modulesParam.split(",").map((m) => m.trim()) : undefined;

    const results = await globalSearch(q, { limit: Math.min(limit, 100), modules });

    return apiSuccess(results);
  } catch (error) {
    return handleApiError(error, "search GET");
  }
}
