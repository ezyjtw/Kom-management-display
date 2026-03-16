/**
 * Session revocation using the SessionMetadata table as a blocklist.
 *
 * Since we use stateless JWTs, we check the session metadata table
 * on each authenticated request for privileged users (admin/lead).
 * Regular users only get checked on sensitive operations.
 *
 * Session revocation failure policy:
 * - Read operations (GET): fail-open (allow access if revocation check fails)
 * - Mutations (POST/PUT/PATCH/DELETE): fail-closed (deny access if check fails)
 * - Sensitive actions: fail-closed (always deny on failure)
 *
 * The caller (requireAuth) decides which policy to apply based on the request.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Check if a session token has been revoked.
 * Always queries the DB directly for multi-instance consistency.
 */
export async function isSessionRevoked(sessionToken: string): Promise<boolean> {
  try {
    const session = await prisma.sessionMetadata.findUnique({
      where: { sessionToken },
      select: { revokedAt: true, expiresAt: true },
    });

    if (!session) return false;

    // Check if revoked
    if (session.revokedAt) {
      return true;
    }

    // Check if expired
    if (session.expiresAt < new Date()) {
      return true;
    }

    return false;
  } catch (error) {
    logger.error("Failed to check session revocation", {
      error: error instanceof Error ? error.message : String(error),
    });
    // Caller decides fail-open vs fail-closed based on request method
    throw error;
  }
}

/**
 * Update lastActiveAt for idle timeout tracking.
 * Only updates if more than 60 seconds since last update to avoid DB spam.
 * Non-critical — failures are swallowed to avoid breaking the request.
 */
export async function updateLastActive(userId: string): Promise<void> {
  try {
    await prisma.sessionMetadata.updateMany({
      where: {
        userId,
        revokedAt: null,
        lastActiveAt: { lt: new Date(Date.now() - 60_000) },
      },
      data: { lastActiveAt: new Date() },
    });
  } catch {
    // Non-critical - don't break the request
  }
}

/**
 * Record a new session.
 */
export async function recordSession(data: {
  userId: string;
  sessionToken: string;
  ipAddress?: string;
  userAgent?: string;
  expiresAt: Date;
}): Promise<void> {
  try {
    await prisma.sessionMetadata.upsert({
      where: { sessionToken: data.sessionToken },
      update: {
        lastActiveAt: new Date(),
        ipAddress: data.ipAddress || "",
        userAgent: data.userAgent || "",
      },
      create: {
        userId: data.userId,
        sessionToken: data.sessionToken,
        ipAddress: data.ipAddress || "",
        userAgent: data.userAgent || "",
        expiresAt: data.expiresAt,
      },
    });
  } catch (error) {
    logger.error("Failed to record session", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Revoke a specific session.
 */
export async function revokeSession(
  sessionToken: string,
  reason: string = "admin_revocation",
): Promise<boolean> {
  try {
    await prisma.sessionMetadata.update({
      where: { sessionToken },
      data: {
        revokedAt: new Date(),
        revokeReason: reason,
      },
    });
    logger.security("Session revoked", { sessionToken: sessionToken.substring(0, 8) + "...", reason });
    return true;
  } catch (error) {
    logger.error("Failed to revoke session", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Revoke all sessions for a user (e.g., on password change or forced logout).
 */
export async function revokeAllUserSessions(
  userId: string,
  reason: string = "all_sessions_revoked",
): Promise<number> {
  try {
    const result = await prisma.sessionMetadata.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        revokeReason: reason,
      },
    });

    logger.security("All sessions revoked for user", { userId, count: result.count, reason });
    return result.count;
  } catch (error) {
    logger.error("Failed to revoke all user sessions", {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * List active sessions for a user.
 */
export async function listUserSessions(userId: string) {
  return prisma.sessionMetadata.findMany({
    where: {
      userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { lastActiveAt: "desc" },
    select: {
      id: true,
      sessionToken: true,
      ipAddress: true,
      userAgent: true,
      lastActiveAt: true,
      expiresAt: true,
      createdAt: true,
    },
  });
}

/**
 * Clean up expired sessions (run periodically).
 */
export async function cleanupExpiredSessions(): Promise<number> {
  try {
    const result = await prisma.sessionMetadata.deleteMany({
      where: {
        expiresAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // 7 days past expiry
      },
    });
    return result.count;
  } catch (error) {
    logger.error("Failed to cleanup expired sessions", {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}
