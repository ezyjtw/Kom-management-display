import { NextRequest, NextResponse } from "next/server";
import { isSessionRevoked } from "@/lib/session-revocation";

/**
 * GET /api/sessions/check?token=<jti>
 *
 * Internal endpoint used by middleware to check if a session has been revoked.
 * Protected by a shared secret header to prevent external abuse.
 * Not listed in the middleware matcher — runs unauthenticated by design.
 */
export async function GET(request: NextRequest) {
  // Verify internal call via shared secret
  const internalSecret = request.headers.get("x-internal-check");
  if (!internalSecret || internalSecret !== process.env.NEXTAUTH_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
