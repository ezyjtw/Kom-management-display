import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import {
  fetchTransfers,
  isNotabeneConfigured,
} from "@/lib/integrations/notabene";
import { apiSuccess, handleApiError } from "@/lib/api/response";

/**
 * GET /api/integrations/notabene
 * Return Notabene integration status + recent transfers.
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const configured = isNotabeneConfigured();

  if (!configured) {
    return apiSuccess({ configured: false, transfers: [], total: 0 });
  }

  try {
    const { transfers, total } = await fetchTransfers({ perPage: 50 });
    return apiSuccess({ configured: true, transfers, total });
  } catch (error) {
    return handleApiError(error, "notabene transfers");
  }
}
