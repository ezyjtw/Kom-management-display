/**
 * Centralized authorization service.
 *
 * Every route handler calls this to check whether the current user
 * can perform a given action on a given resource with the appropriate scope.
 */
import { NextResponse } from "next/server";
import type { AuthUser } from "@/lib/auth-user";
import {
  AUTHORIZATION_MATRIX,
  SENSITIVE_FIELDS,
  type Role,
  type Resource,
  type Action,
  type ScopeType,
} from "@/modules/auth/types";

export interface AuthzResult {
  allowed: boolean;
  scope: ScopeType;
  reason?: string;
}

/**
 * Check if a user is authorized to perform an action on a resource.
 */
export function checkAuthorization(
  user: AuthUser,
  resource: Resource,
  action: Action,
): AuthzResult {
  const role = user.role as Role;
  const permissions = AUTHORIZATION_MATRIX[role]?.[resource];

  if (!permissions) {
    return { allowed: false, scope: "none", reason: `Role '${role}' has no permissions for '${resource}'` };
  }

  if (!permissions.actions.includes(action)) {
    return { allowed: false, scope: permissions.scope, reason: `Role '${role}' cannot '${action}' on '${resource}'` };
  }

  return { allowed: true, scope: permissions.scope };
}

/**
 * Require authorization — returns 403 response if not allowed.
 */
export function requireAuthorization(
  user: AuthUser,
  resource: Resource,
  action: Action,
): AuthzResult | NextResponse {
  const result = checkAuthorization(user, resource, action);
  if (!result.allowed) {
    return NextResponse.json(
      { success: false, error: "Insufficient permissions", detail: result.reason },
      { status: 403 },
    );
  }
  return result;
}

/**
 * Apply scope filtering to a Prisma where clause based on the user's scope.
 */
export function applyScopeFilter(
  user: AuthUser,
  scope: ScopeType,
  where: Record<string, unknown> = {},
  opts?: {
    ownerField?: string;
    teamField?: string;
    employeeIdField?: string;
  },
): Record<string, unknown> {
  const ownerField = opts?.ownerField ?? "ownerUserId";
  const teamField = opts?.teamField ?? "employee.team";
  const employeeIdField = opts?.employeeIdField ?? "employeeId";

  switch (scope) {
    case "own":
      if (user.employeeId) {
        where[employeeIdField] = user.employeeId;
      }
      break;
    case "team":
      if (user.team) {
        // Handle nested relations like "employee.team"
        const parts = teamField.split(".");
        if (parts.length === 2) {
          where[parts[0]] = { ...(where[parts[0]] as object || {}), [parts[1]]: user.team };
        } else {
          where[teamField] = user.team;
        }
      }
      break;
    case "all":
      // No additional filtering
      break;
    case "none":
      // Should have been caught by checkAuthorization
      where.id = "__DENY_ALL__";
      break;
  }

  return where;
}

/**
 * Mask sensitive fields in an object based on the user's role.
 */
export function maskSensitiveFields<T extends Record<string, unknown>>(
  data: T,
  resource: Resource,
  userRole: string,
): T {
  if (userRole === "admin") return data;

  const sensitiveFields = SENSITIVE_FIELDS[resource] || [];
  if (sensitiveFields.length === 0) return data;

  const masked: Record<string, unknown> = { ...data };
  for (const field of sensitiveFields) {
    if (field in masked && masked[field]) {
      const val = masked[field];
      if (typeof val === "string") {
        masked[field] = val.length > 4
          ? `${val.substring(0, 2)}${"*".repeat(Math.min(val.length - 4, 20))}${val.substring(val.length - 2)}`
          : "****";
      }
    }
  }
  return masked as T;
}
