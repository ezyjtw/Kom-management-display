import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import {
  fetchSupportedAssets,
  fetchAssetByIdentifier,
  isNotabeneConfigured,
} from "@/lib/integrations/notabene";
import { apiSuccess, handleApiError } from "@/lib/api/response";

/**
 * GET /api/integrations/notabene/assets
 * Fetch supported assets from the Notabene Asset Service.
 *
 * Query params:
 *  - asset: (optional) specific asset identifier to look up (e.g. "eth", "USDC-SOL")
 *
 * Returns the full asset list or a single asset when ?asset= is provided.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "travel_rule_case", "view");
  if (authz instanceof NextResponse) return authz;

  if (!isNotabeneConfigured()) {
    return apiSuccess({ configured: false, assets: [] });
  }

  try {
    const { searchParams } = new URL(request.url);
    const assetId = searchParams.get("asset");

    if (assetId) {
      const asset = await fetchAssetByIdentifier(assetId);
      return apiSuccess({ configured: true, asset: asset ?? null });
    }

    const assets = await fetchSupportedAssets();
    return apiSuccess({ configured: true, assets, total: assets.length });
  } catch (error) {
    return handleApiError(error, "notabene assets");
  }
}
