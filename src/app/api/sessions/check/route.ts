import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { isSessionRevoked } from "@/lib/session-revocation";

/**
 * GET /api/sessions/check?token=<jti>
 *
 * Internal endpoint used by middleware to check if a session has been revoked.
 * Accepts either:
 *   1. A valid user session (via requireAuth), OR
 *   2. An internal shared-secret header (x-internal-check) for middleware calls.
 */
export async function GET(request: NextRequest) {
  // Allow internal middleware calls via shared secret
  const internalSecret = request.headers.get("x-internal-check");
  const isInternalCall = internalSecret && internalSecret === process.env.NEXTAUTH_SECRET;

  if (!isInternalCall) {
    // Fall back to standard session auth
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
  }

  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ revoked: false });
  }

  try {
    const revoked = await isSessionRevoked(token);
    return NextResponse.json({ revoked });
  } catch {
    // Fail-open: don't block users if DB is unavailable
    return NextResponse.json({ revoked: false });
  }
}
