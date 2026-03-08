/**
 * Access review utilities.
 *
 * Provides functions for quarterly access reviews, dormant account
 * detection, privilege creep detection, and break-glass access controls.
 *
 * Access reviews are a key institutional control:
 *   - Detect users with elevated roles who haven't logged in recently
 *   - Detect orphaned admin accounts (no associated employee)
 *   - Generate exportable access review reports
 *   - Track break-glass emergency access with enhanced audit logging
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ─── Types ───

export interface AccessReviewEntry {
  userId: string;
  userName: string;
  email: string;
  role: string;
  employeeId: string | null;
  team: string | null;
  lastLoginAt: string | null;
  daysSinceLogin: number | null;
  sessionCount: number;
  flags: AccessReviewFlag[];
}

export type AccessReviewFlag =
  | "dormant_30d"
  | "dormant_90d"
  | "orphaned_admin"
  | "privilege_no_employee"
  | "multiple_active_sessions";

export interface AccessReviewReport {
  generatedAt: string;
  generatedBy: string;
  totalUsers: number;
  flaggedUsers: number;
  entries: AccessReviewEntry[];
  summary: Record<AccessReviewFlag, number>;
}

export interface BreakGlassRequest {
  userId: string;
  reason: string;
  requestedRole: string;
  expiresInMinutes?: number;
}

export interface BreakGlassGrant {
  grantId: string;
  userId: string;
  originalRole: string;
  grantedRole: string;
  reason: string;
  grantedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

// ─── Access Review ───

/**
 * Generate an access review report covering all user accounts.
 * Flags dormant accounts, orphaned admins, and privilege anomalies.
 */
export async function generateAccessReview(generatedBy: string): Promise<AccessReviewReport> {
  const users = await prisma.user.findMany({
    include: {
      employee: { select: { id: true, team: true, name: true } },
    },
  });

  // Get last login from audit logs for each user
  const loginLogs = await prisma.auditLog.findMany({
    where: {
      action: { in: ["login_success", "login"] },
    },
    orderBy: { createdAt: "desc" },
    select: { userId: true, createdAt: true },
  });

  const lastLoginMap = new Map<string, Date>();
  for (const log of loginLogs) {
    if (!lastLoginMap.has(log.userId)) {
      lastLoginMap.set(log.userId, log.createdAt);
    }
  }

  // Get active session counts
  const sessions = await prisma.sessionMetadata.groupBy({
    by: ["userId"],
    _count: true,
    where: {
      expiresAt: { gt: new Date() },
      revokedAt: null,
    },
  });
  const sessionCountMap = new Map(sessions.map((s) => [s.userId, s._count]));

  const now = Date.now();
  const entries: AccessReviewEntry[] = [];

  for (const user of users) {
    const lastLogin = lastLoginMap.get(user.id);
    const daysSinceLogin = lastLogin
      ? Math.floor((now - lastLogin.getTime()) / (1000 * 60 * 60 * 24))
      : null;
    const sessionCount = sessionCountMap.get(user.id) ?? 0;

    const flags: AccessReviewFlag[] = [];

    // Dormant detection
    if (daysSinceLogin !== null && daysSinceLogin > 90) {
      flags.push("dormant_90d");
    } else if (daysSinceLogin !== null && daysSinceLogin > 30) {
      flags.push("dormant_30d");
    } else if (daysSinceLogin === null) {
      flags.push("dormant_90d"); // Never logged in
    }

    // Orphaned admin: admin role but no linked employee
    if (user.role === "admin" && !user.employee) {
      flags.push("orphaned_admin");
    }

    // Privilege without employee link
    if ((user.role === "admin" || user.role === "lead") && !user.employeeId) {
      flags.push("privilege_no_employee");
    }

    // Multiple active sessions
    if (sessionCount > 3) {
      flags.push("multiple_active_sessions");
    }

    entries.push({
      userId: user.id,
      userName: user.name,
      email: user.email,
      role: user.role,
      employeeId: user.employeeId,
      team: user.employee?.team ?? null,
      lastLoginAt: lastLogin?.toISOString() ?? null,
      daysSinceLogin,
      sessionCount,
      flags,
    });
  }

  const flaggedEntries = entries.filter((e) => e.flags.length > 0);

  // Build summary counts
  const summary: Record<AccessReviewFlag, number> = {
    dormant_30d: 0,
    dormant_90d: 0,
    orphaned_admin: 0,
    privilege_no_employee: 0,
    multiple_active_sessions: 0,
  };
  for (const entry of entries) {
    for (const flag of entry.flags) {
      summary[flag]++;
    }
  }

  const report: AccessReviewReport = {
    generatedAt: new Date().toISOString(),
    generatedBy,
    totalUsers: entries.length,
    flaggedUsers: flaggedEntries.length,
    entries,
    summary,
  };

  // Log the review
  logger.info("Access review generated", {
    generatedBy,
    totalUsers: report.totalUsers,
    flaggedUsers: report.flaggedUsers,
    summary,
  });

  await prisma.auditLog.create({
    data: {
      action: "access_review_generated",
      entityType: "system",
      entityId: "access_review",
      userId: generatedBy,
      details: JSON.stringify({
        totalUsers: report.totalUsers,
        flaggedUsers: report.flaggedUsers,
        summary,
      }),
    },
  });

  return report;
}

// ─── Break-Glass Access ───

const BREAK_GLASS_DEFAULT_EXPIRY_MINUTES = 60;
const BREAK_GLASS_MAX_EXPIRY_MINUTES = 240;

/**
 * Grant temporary elevated access for emergency situations.
 * Records the grant in audit log and returns a time-limited grant.
 *
 * Break-glass access:
 *   - Requires a mandatory reason
 *   - Time-limited (default: 60 minutes, max: 4 hours)
 *   - Enhanced audit logging
 *   - Original role is preserved for automatic restoration
 */
export async function grantBreakGlassAccess(
  request: BreakGlassRequest,
  grantedBy: string,
): Promise<BreakGlassGrant> {
  const { userId, reason, requestedRole, expiresInMinutes } = request;

  if (!reason || reason.trim().length < 10) {
    throw new Error("Break-glass access requires a detailed reason (minimum 10 characters)");
  }

  const expiryMinutes = Math.min(
    expiresInMinutes ?? BREAK_GLASS_DEFAULT_EXPIRY_MINUTES,
    BREAK_GLASS_MAX_EXPIRY_MINUTES,
  );

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error(`User ${userId} not found`);

  const originalRole = user.role;
  const grantedAt = new Date();
  const expiresAt = new Date(grantedAt.getTime() + expiryMinutes * 60 * 1000);

  // Update user role temporarily
  await prisma.user.update({
    where: { id: userId },
    data: { role: requestedRole as never },
  });

  const grantId = `bg_${Date.now()}_${userId}`;

  // Create enhanced audit trail
  await prisma.auditLog.create({
    data: {
      action: "break_glass_granted",
      entityType: "user",
      entityId: userId,
      userId: grantedBy,
      details: JSON.stringify({
        grantId,
        originalRole,
        grantedRole: requestedRole,
        reason,
        expiresAt: expiresAt.toISOString(),
        expiryMinutes,
      }),
    },
  });

  logger.warn("SECURITY: Break-glass access granted", {
    type: "security",
    securityEvent: true,
    grantId,
    userId,
    originalRole,
    grantedRole: requestedRole,
    grantedBy,
    reason,
    expiresAt: expiresAt.toISOString(),
  });

  return {
    grantId,
    userId,
    originalRole,
    grantedRole: requestedRole,
    reason,
    grantedAt: grantedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    revokedAt: null,
  };
}

/**
 * Revoke break-glass access and restore original role.
 */
export async function revokeBreakGlassAccess(
  userId: string,
  originalRole: string,
  revokedBy: string,
  grantId: string,
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { role: originalRole as never },
  });

  await prisma.auditLog.create({
    data: {
      action: "break_glass_revoked",
      entityType: "user",
      entityId: userId,
      userId: revokedBy,
      details: JSON.stringify({
        grantId,
        restoredRole: originalRole,
        revokedBy,
      }),
    },
  });

  logger.warn("SECURITY: Break-glass access revoked", {
    type: "security",
    securityEvent: true,
    grantId,
    userId,
    restoredRole: originalRole,
    revokedBy,
  });
}
