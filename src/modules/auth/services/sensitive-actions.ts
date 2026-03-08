/**
 * Sensitive Action Registry & Step-Up Auth
 *
 * Defines which actions require re-authentication or elevated privileges.
 * Used by middleware and route handlers to enforce step-up auth for
 * high-risk operations.
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ─── Types ───

export type SensitiveActionCategory =
  | "config_change"       // Scoring config, feature flags, branding
  | "user_management"     // Create/delete users, role changes
  | "data_export"         // Bulk data exports
  | "settlement_approval" // Settlement sign-offs
  | "session_management"  // Revoking other users' sessions
  | "break_glass";        // Emergency override actions

export interface SensitiveAction {
  category: SensitiveActionCategory;
  requiresReauth: boolean;
  requiresDualControl: boolean;
  maxSessionAgeSeconds: number; // Session must be younger than this
  auditLevel: "standard" | "enhanced"; // Enhanced = extra detail in audit
}

/**
 * Registry of sensitive actions mapped by API path pattern + method.
 * These actions require fresher sessions and enhanced audit logging.
 */
export const SENSITIVE_ACTION_REGISTRY: Record<string, SensitiveAction> = {
  // Config changes
  "PUT:/api/scores/config": {
    category: "config_change",
    requiresReauth: false,
    requiresDualControl: false,
    maxSessionAgeSeconds: 2 * 60 * 60, // 2 hours
    auditLevel: "enhanced",
  },
  "PUT:/api/feature-flags": {
    category: "config_change",
    requiresReauth: false,
    requiresDualControl: false,
    maxSessionAgeSeconds: 2 * 60 * 60,
    auditLevel: "enhanced",
  },
  "PUT:/api/branding": {
    category: "config_change",
    requiresReauth: false,
    requiresDualControl: false,
    maxSessionAgeSeconds: 2 * 60 * 60,
    auditLevel: "enhanced",
  },

  // User management
  "POST:/api/users": {
    category: "user_management",
    requiresReauth: true,
    requiresDualControl: false,
    maxSessionAgeSeconds: 1 * 60 * 60, // 1 hour
    auditLevel: "enhanced",
  },
  "DELETE:/api/users": {
    category: "user_management",
    requiresReauth: true,
    requiresDualControl: false,
    maxSessionAgeSeconds: 1 * 60 * 60,
    auditLevel: "enhanced",
  },

  // Data exports
  "POST:/api/export": {
    category: "data_export",
    requiresReauth: false,
    requiresDualControl: true,
    maxSessionAgeSeconds: 4 * 60 * 60,
    auditLevel: "enhanced",
  },

  // Settlement approvals
  "PUT:/api/settlements": {
    category: "settlement_approval",
    requiresReauth: false,
    requiresDualControl: true,
    maxSessionAgeSeconds: 2 * 60 * 60,
    auditLevel: "enhanced",
  },
  "PUT:/api/usdc-ramp": {
    category: "settlement_approval",
    requiresReauth: false,
    requiresDualControl: true,
    maxSessionAgeSeconds: 2 * 60 * 60,
    auditLevel: "enhanced",
  },

  // Session management
  "DELETE:/api/sessions": {
    category: "session_management",
    requiresReauth: true,
    requiresDualControl: false,
    maxSessionAgeSeconds: 1 * 60 * 60,
    auditLevel: "enhanced",
  },
};

/**
 * Look up whether a request hits a sensitive action.
 * Returns the action config if matched, null otherwise.
 */
export function lookupSensitiveAction(
  method: string,
  pathname: string,
): SensitiveAction | null {
  // Try exact match first
  const key = `${method}:${pathname}`;
  if (SENSITIVE_ACTION_REGISTRY[key]) {
    return SENSITIVE_ACTION_REGISTRY[key];
  }

  // Try prefix match (for routes with dynamic segments)
  for (const [pattern, action] of Object.entries(SENSITIVE_ACTION_REGISTRY)) {
    const [patMethod, patPath] = pattern.split(":");
    if (patMethod === method && pathname.startsWith(patPath)) {
      return action;
    }
  }

  return null;
}

/**
 * Check if the session is fresh enough for a sensitive action.
 */
export function isSessionFreshEnough(
  sessionIssuedAt: number, // unix seconds
  action: SensitiveAction,
): boolean {
  const ageSeconds = Math.floor(Date.now() / 1000) - sessionIssuedAt;
  return ageSeconds <= action.maxSessionAgeSeconds;
}

/**
 * Log a sensitive action to the audit trail with enhanced detail.
 */
export async function auditSensitiveAction(params: {
  userId: string;
  action: string;
  category: SensitiveActionCategory;
  resource: string;
  resourceId: string;
  details: Record<string, unknown>;
  sessionAge: number;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: `sensitive_${params.action}`,
        entityType: params.resource,
        entityId: params.resourceId,
        userId: params.userId,
        details: JSON.stringify({
          ...params.details,
          sensitiveCategory: params.category,
          sessionAgeSeconds: params.sessionAge,
          timestamp: new Date().toISOString(),
        }),
      },
    });

    logger.security(`Sensitive action: ${params.category}/${params.action}`, {
      userId: params.userId,
      resource: params.resource,
      resourceId: params.resourceId,
      sessionAge: params.sessionAge,
    });
  } catch (error) {
    logger.error("Failed to audit sensitive action", {
      error: String(error),
      userId: params.userId,
      action: params.action,
    });
  }
}
