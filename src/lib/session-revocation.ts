/**
 * Session revocation using the SessionMetadata table as a blocklist.
 *
 * Since we use stateless JWTs, we check the session metadata table
 * on each authenticated request for privileged users (admin/lead).
 * Regular users only get checked on sensitive operations.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// In-memory cache of revoked session tokens (cleared every 5 minutes)
let revokedCache: Set<string> = new Set();
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check if a session token has been revoked.
 */
export async function isSessionRevoked(sessionToken: string): Promise<boolean> {
  // Check in-memory cache first
  if (Date.now() < cacheExpiresAt && revokedCache.has(sessionToken)) {
    return true;
  }

  try {
    const session = await prisma.sessionMetadata.findUnique({
      where: { sessionToken },
      select: { revokedAt: true, expiresAt: true },
    });

    if (!session) return false;

    // Check if revoked
    if (session.revokedAt) {
      revokedCache.add(sessionToken);
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
    return false; // fail-open to avoid locking out all users on DB issues
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
    revokedCache.add(sessionToken);
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

    // Invalidate cache
    revokedCache = new Set();
    cacheExpiresAt = 0;

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
