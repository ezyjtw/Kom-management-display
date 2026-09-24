/**
 * Sensitive Action step-up auth — Prisma-backed audit helper.
 *
 * The registry data and pure lookup/freshness helpers live in
 * ../sensitive-actions-registry.ts (dependency-free, Edge-safe). This module
 * re-exports them for convenience and adds the enhanced audit-logging helper,
 * which requires Prisma and therefore cannot run in Edge middleware.
 *
 * Enforcement wiring:
 *   - Session freshness (maxSessionAgeSeconds): enforced in src/middleware.ts
 *     via lookupSensitiveAction (single source of truth).
 *   - Dual control (requiresDualControl): enforced at the route level through
 *     the maker/checker flow on settlements and usdc-ramp.
 *   - Reauth: a sensitive action with a stale sign-in gets 401 REAUTH_REQUIRED
 *     from the middleware, and the browser re-authenticates with Entra
 *     (prompt=login). This proves a recent sign-in, not a fresh MFA challenge;
 *     Entra authentication context is future work (threat-model.md §8).
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  type SensitiveAction,
  type SensitiveActionCategory,
  SENSITIVE_ACTION_REGISTRY,
  lookupSensitiveAction,
  isSessionFreshEnough,
} from "@/modules/auth/sensitive-actions-registry";

export {
  type SensitiveAction,
  type SensitiveActionCategory,
  SENSITIVE_ACTION_REGISTRY,
  lookupSensitiveAction,
  isSessionFreshEnough,
};

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
