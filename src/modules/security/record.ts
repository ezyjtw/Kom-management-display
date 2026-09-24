/**
 * Audit-only security events (spec §17.7): permission denials, role changes,
 * integration credential use and failures. Dependency-light (no alerting
 * imports) so auth guards and the HTTP client can call it. Counting rules over
 * these entries are in src/modules/alerting/evaluators/security.ts.
 *
 * Best-effort: recording a security event must never turn a denial into a 500
 * or break a connector call. A failed write is logged at error level.
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { SECURITY_ACTIONS } from "@/modules/security/actions";

export async function writeSecurityAudit(action: string, entityType: string, entityId: string, actorUserId: string | null, details: Record<string, unknown>): Promise<boolean> {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entityType,
        entityId: entityId.slice(0, 200),
        // A User id is normalised to its Employee (or "system") by the AuditLog trigger (baseline migration).
        userId: actorUserId ?? "system",
        actorUserId,
        actorType: actorUserId ? "user" : "system",
        details: JSON.stringify(details),
      },
    });
    return true;
  } catch (error) {
    logger.error("AUDIT_WRITE_FAILED: security event not recorded", { action, entityType, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/** A request was refused for lack of permission (403). Counted by ALR-SEC-01. */
export async function recordPermissionDenied(input: { userId: string | null; role?: string | null; method?: string | null; path?: string | null; reason?: string }): Promise<void> {
  logger.security("Permission denied", { method: input.method, path: input.path, role: input.role });
  await writeSecurityAudit(SECURITY_ACTIONS.permissionDenied, "route", `${input.method ?? "?"} ${input.path ?? "?"}`, input.userId, {
    summary: "Permission denied",
    metadata: { role: input.role ?? null, reason: input.reason ?? null },
  });
}

/** A user's role changed (admin edit or an SSO group change). ALR-SEC-02 picks it up from the audit log. */
export async function recordRoleChange(input: { targetUserId: string; from: string | null; to: string; source: "sso_group" | "admin"; actorUserId: string | null }): Promise<void> {
  await writeSecurityAudit(SECURITY_ACTIONS.roleChanged, "user", input.targetUserId, input.actorUserId, {
    summary: `Role changed from ${input.from ?? "none"} to ${input.to} (${input.source})`,
    before: { role: input.from },
    after: { role: input.to },
    metadata: { source: input.source },
  });
}

/** An integration credential was used to obtain a token (custody API user secret, spec §17.7). */
export async function recordCredentialUse(input: { connector: string; credentialLabel: string; workload?: string }): Promise<void> {
  await writeSecurityAudit(SECURITY_ACTIONS.credentialUsed, "integration_credential", `${input.connector}:${input.credentialLabel}`, null, {
    summary: `${input.connector} credential used`,
    metadata: { connector: input.connector, credential: input.credentialLabel, workload: input.workload ?? "unknown" },
  });
}

/** A connector answered 401 or 403. Repeated failures raise ALR-SEC-05. */
export async function recordIntegrationAuthFailure(input: { host: string; status: number }): Promise<void> {
  logger.security("Integration authentication failure", { host: input.host, status: input.status });
  await writeSecurityAudit(SECURITY_ACTIONS.credentialFailure, "integration_host", input.host, null, {
    summary: `Connector answered ${input.status}`,
    metadata: { host: input.host, status: input.status },
  });
}


/**
 * Record a denial from inside a route handler. Method and path come from the
 * headers the middleware sets (x-http-method, x-pathname).
 */
export async function recordDeniedForCurrentRequest(user: { id?: string | null; role?: string | null } | null, reason?: string): Promise<void> {
  let method: string | null = null;
  let path: string | null = null;
  let userId: string | null = user?.id || null;
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    method = h.get("x-http-method");
    path = h.get("x-pathname");
    userId ??= h.get("x-user-id");
  } catch {
    // outside a request (worker, tests): record without the route
  }
  await recordPermissionDenied({ userId, role: user?.role ?? null, method, path, reason });
}
