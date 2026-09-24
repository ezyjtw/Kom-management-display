/** GET /api/me/capabilities — what the navigation may show this user (restricted views such as RLS). Informational; every API enforces its own access. */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { canViewRealisations } from "@/modules/realisations/access";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  try {
    return apiSuccess({ realisations: await canViewRealisations(auth) });
  } catch (error) {
    return handleApiError(error, "capabilities GET");
  }
}
