import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import {
  fetchTransfers,
  isNotabeneConfigured,
} from "@/lib/integrations/notabene";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { featureGate } from "@/lib/feature-gate";

/**
 * GET /api/integrations/notabene
 * Return Notabene integration status + recent transfers.
 */
export async function GET() {
  const gated = await featureGate("integration.notabene.enabled");
  if (gated) return gated;

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "travel_rule_case", "view");
  if (authz instanceof NextResponse) return authz;

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
