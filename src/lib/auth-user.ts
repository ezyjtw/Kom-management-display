import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { authOptions } from "@/lib/auth-options";
import { isSessionRevoked, updateLastActive } from "@/lib/session-revocation";
import { logger } from "@/lib/logger";

/** HTTP methods that change state — these get a fail-closed revocation policy. */
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  employeeId: string | null;
  team: string | null;
}

/**
 * Get the authenticated user from the current request context.
 * Returns null if not authenticated.
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;

  return {
    id: session.user.id || "",
    name: session.user.name || "Unknown",
    email: session.user.email || "",
    role: session.user.role || "employee",
    employeeId: session.user.employeeId ?? null,
    team: session.user.team ?? null,
  };
}

/**
 * Require the user to be authenticated. Returns 401 if not.
 *
 * Also performs session revocation check (Prisma available here, unlike Edge
 * middleware) and updates lastActiveAt for idle timeout tracking.
 */
export async function requireAuth(): Promise<AuthUser | NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  // Check if session has been revoked (Prisma available here, unlike Edge middleware)
  const jti = session.user.jti;
  if (session.user.id && jti) {
    try {
      const revoked = await isSessionRevoked(jti);
      if (revoked) {
        return NextResponse.json(
          { success: false, error: "Session has been revoked", code: "SESSION_REVOKED" },
          { status: 401 }
        );
      }
    } catch (error) {
      // isSessionRevoked throws on DB errors. Policy:
      //   - mutations (POST/PUT/PATCH/DELETE): fail CLOSED — deny rather than
      //     risk processing a state change for a revoked session.
      //   - reads (GET/HEAD): fail OPEN — avoid locking everyone out on a blip.
      // The HTTP method is forwarded by middleware as x-http-method.
      let method = "GET";
      try {
        method = headers().get("x-http-method")?.toUpperCase() || "GET";
      } catch {
        // headers() unavailable outside a request scope — treat as read.
      }
      if (MUTATION_METHODS.has(method)) {
        logger.security("Session revocation check failed on mutation — failing closed", {
          error: error instanceof Error ? error.message : String(error),
          method,
        });
        return NextResponse.json(
          { success: false, error: "Unable to verify session state", code: "SESSION_CHECK_FAILED" },
          { status: 503 }
        );
      }
      // read path: fall through (fail open)
    }
  }

  // Update lastActiveAt for idle timeout tracking (non-blocking, fire-and-forget)
  if (session.user.id) {
    updateLastActive(session.user.id).catch(() => {});
  }

  return {
    id: session.user.id || "",
    name: session.user.name || "Unknown",
    email: session.user.email || "",
    role: session.user.role || "employee",
    employeeId: session.user.employeeId ?? null,
    team: session.user.team ?? null,
  };
}

/**
 * Require the user to have one of the specified roles.
 * Returns 403 if the user doesn't have permission.
 */
export async function requireRole(...roles: string[]): Promise<AuthUser | NextResponse> {
  const result = await requireAuth();
  if (result instanceof NextResponse) return result;

  if (!roles.includes(result.role)) {
    return NextResponse.json(
      { success: false, error: "Insufficient permissions" },
      { status: 403 }
    );
  }
  return result;
}

/**
 * Sanitize error for client response — never expose internals.
 * Logs full error server-side for debugging.
 */
export function safeErrorMessage(error: unknown, context?: string): string {
  // Always log full error server-side
  logger.error(`API Error${context ? ` ${context}` : ""}`, { error: error instanceof Error ? error.message : String(error) });

  if (error instanceof Error) {
    if (error.message.includes("Unique constraint")) {
      return "A record with this value already exists";
    }
    if (error.message.includes("Record to update not found") || error.message.includes("Record to delete does not exist")) {
      return "Record not found";
    }
    if (error.message.includes("Foreign key constraint")) {
      return "Referenced record does not exist";
    }
    if (error.message.includes("Invalid `") || error.message.includes("Argument")) {
      return "Invalid request data";
    }
  }
  return "An internal error occurred";
}
