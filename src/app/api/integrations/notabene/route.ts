import { NextResponse } from "next/server";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";
import {
  fetchTransfers,
  isNotabeneConfigured,
} from "@/lib/integrations/notabene";

/**
 * GET /api/integrations/notabene
 * Return Notabene integration status + recent transfers.
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const configured = isNotabeneConfigured();

  if (!configured) {
    return NextResponse.json({
      success: true,
      data: { configured: false, transfers: [], total: 0 },
    });
  }

  try {
    const { transfers, total } = await fetchTransfers({ perPage: 50 });
    return NextResponse.json({
      success: true,
      data: { configured: true, transfers, total },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}
