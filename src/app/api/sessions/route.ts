import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth-user";
import {
  listUserSessions,
  revokeSession,
  revokeAllUserSessions,
} from "@/lib/session-revocation";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

/**
 * GET /api/sessions
 * List active sessions for the current user, or for a specific user (admin only).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get("userId");

    // Non-admin can only view their own sessions
    if (targetUserId && targetUserId !== auth.id && auth.role !== "admin") {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const userId = targetUserId || auth.id;
    const sessions = await listUserSessions(userId);

    // Mask session tokens for security
    const masked = sessions.map((s) => ({
      ...s,
      sessionToken: s.sessionToken.substring(0, 8) + "..." + s.sessionToken.slice(-4),
    }));

    return apiSuccess({ sessions: masked, count: masked.length });
  } catch (error) {
    return handleApiError(error, "sessions GET");
  }
}

/**
 * POST /api/sessions
 * Revoke a session or all sessions for a user.
 * Body: { action: "revoke" | "revoke_all", sessionToken?, userId?, reason? }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const body = await request.json();
    const { action, sessionToken, userId, reason } = body;

    if (!action) {
      return apiValidationError("action is required (revoke, revoke_all)");
    }

    switch (action) {
      case "revoke": {
        if (!sessionToken) return apiValidationError("sessionToken is required");

        // Admin can revoke any session; users can only revoke their own
        if (auth.role !== "admin") {
          // Verify the session belongs to the current user
          const sessions = await listUserSessions(auth.id);
          const owns = sessions.some((s) => s.sessionToken === sessionToken);
          if (!owns) {
            return NextResponse.json(
              { success: false, error: "Cannot revoke sessions belonging to other users" },
              { status: 403 },
            );
          }
        }

        const revoked = await revokeSession(sessionToken, reason || "user_revocation");
        return apiSuccess({ revoked });
      }

      case "revoke_all": {
        const targetUserId = userId || auth.id;

        // Only admin can revoke other users' sessions
        if (targetUserId !== auth.id && auth.role !== "admin") {
          return NextResponse.json(
            { success: false, error: "Insufficient permissions" },
            { status: 403 },
          );
        }

        const count = await revokeAllUserSessions(targetUserId, reason || "all_sessions_revoked");
        return apiSuccess({ revokedCount: count });
      }

      default:
        return apiValidationError(`Unknown action: ${action}`);
    }
  } catch (error) {
    return handleApiError(error, "sessions POST");
  }
}
