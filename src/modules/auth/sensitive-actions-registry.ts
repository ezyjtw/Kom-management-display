/**
 * Sensitive Action Registry (pure data + lookup).
 *
 * This module is intentionally dependency-free (no Prisma, no logger) so it can
 * be imported from BOTH Edge middleware and Node route handlers. It is the
 * single source of truth for which actions require a fresher session, dual
 * control, or enhanced audit. The Prisma-backed audit helper lives in
 * services/sensitive-actions.ts.
 */

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
  auditLevel: "standard" | "enhanced";
}

/**
 * Registry of sensitive actions mapped by "METHOD:path" pattern.
 * Prefix-matched for routes with dynamic segments.
 */
export const SENSITIVE_ACTION_REGISTRY: Record<string, SensitiveAction> = {
  // Config changes
  "PUT:/api/scores/config": {
    category: "config_change",
    requiresReauth: false,
    requiresDualControl: false,
    maxSessionAgeSeconds: 2 * 60 * 60,
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
    maxSessionAgeSeconds: 1 * 60 * 60,
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

  // Settlement approvals (dual control enforced at route level via maker/checker)
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
 * Exact match first, then prefix match for dynamic segments.
 */
export function lookupSensitiveAction(
  method: string,
  pathname: string,
): SensitiveAction | null {
  const key = `${method}:${pathname}`;
  if (SENSITIVE_ACTION_REGISTRY[key]) {
    return SENSITIVE_ACTION_REGISTRY[key];
  }
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
