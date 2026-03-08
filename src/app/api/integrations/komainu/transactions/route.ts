import { NextRequest, NextResponse } from "next/server";
import {
  fetchPendingTransactions,
  fetchPendingRequests,
  isKomainuConfigured,
} from "@/lib/integrations/komainu";
import { requireAuth } from "@/lib/auth-user";
import { apiSuccess, handleApiError } from "@/lib/api/response";

/**
 * GET /api/integrations/komainu/transactions
 * Fetch pending transactions and pending requests from the Komainu API.
 *
 * Query params:
 *   page - page number (default 1)
 *   pageSize - items per page (default 50)
 *   asset - filter by asset code (e.g. "BTC")
 *   type - for requests: CREATE_TRANSACTION, COLLATERAL_OPERATION_OFFCHAIN, COLLATERAL_OPERATION_ONCHAIN
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  if (!isKomainuConfigured()) {
    return apiSuccess({
      pendingTransactions: [],
      pendingRequests: [],
      transactionCount: 0,
      requestCount: 0,
      configured: false,
    });
  }

  try {
    const { searchParams } = request.nextUrl;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "50", 10);
    const asset = searchParams.get("asset") || undefined;
    const type = searchParams.get("type") || undefined;

    const [txResult, reqResult] = await Promise.all([
      fetchPendingTransactions({ page, pageSize, asset }),
      fetchPendingRequests({ page, pageSize, type }),
    ]);

    return apiSuccess({
      pendingTransactions: txResult.data,
      pendingRequests: reqResult.data,
      transactionCount: txResult.count,
      requestCount: reqResult.count,
      transactionHasNext: txResult.has_next,
      requestHasNext: reqResult.has_next,
      configured: true,
    });
  } catch (error) {
    return handleApiError(error, "komainu transactions");
  }
}
