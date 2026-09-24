/**
 * Client isolation (spec §17.5), enforced server-side in one place. Every
 * client-scoped read and write goes through this module:
 *
 * - list queries merge `clientWhere(scope)` into their where clause;
 * - by-id access calls `workItemScopeGuard` (or `canSeeClient`), which answers
 *   404 rather than 403 so ids of other clients' items cannot be probed.
 *
 * A user with no UserClientScope rows is unrestricted (TODO(CONFIRM-CLIENT-SCOPING)).
 * A user with rows sees only those clients, plus work that has no client
 * (internal tasks, platform alerts). Admins and auditors are never restricted.
 * The cross-client text checks for client-visible content (spec §9.7) are in
 * src/modules/client-incidents/guards.ts.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiNotFoundError } from "@/lib/api/response";
import { recordDeniedForCurrentRequest } from "@/modules/security/record";

export type ClientScope = { all: true } | { all: false; clientIds: string[] };

const UNRESTRICTED_ROLES = new Set(["admin", "auditor"]);

export async function clientScopeFor(user: { id: string; role?: string | null }): Promise<ClientScope> {
  if (user.role && UNRESTRICTED_ROLES.has(user.role)) return { all: true };
  const rows = await prisma.userClientScope.findMany({ where: { userId: user.id }, select: { clientId: true } });
  return rows.length ? { all: false, clientIds: rows.map((r) => r.clientId) } : { all: true };
}

/** Where fragment for a model with a nullable client column. */
export function clientWhere(scope: ClientScope, field = "clientId"): Record<string, unknown> {
  if (scope.all) return {};
  return { OR: [{ [field]: null }, { [field]: { in: scope.clientIds } }] };
}

/** Where fragment for the Client table itself. */
export function clientTableWhere(scope: ClientScope): Record<string, unknown> {
  return scope.all ? {} : { id: { in: scope.clientIds } };
}

export function canSeeClient(scope: ClientScope, clientId: string | null | undefined): boolean {
  return scope.all || !clientId || scope.clientIds.includes(clientId);
}

/**
 * By-id guard for a work item: null when the user may see it (or it does not
 * exist; the caller's own lookup reports that), a 404 response when it
 * belongs to a client outside the user's scope.
 */
export async function workItemScopeGuard(user: { id: string; role?: string | null }, workItemId: string): Promise<NextResponse | null> {
  const scope = await clientScopeFor(user);
  if (scope.all) return null;
  const item = await prisma.workItem.findUnique({ where: { id: workItemId }, select: { clientId: true } });
  if (!item || canSeeClient(scope, item.clientId)) return null;
  void recordDeniedForCurrentRequest(user, "client_out_of_scope");
  return apiNotFoundError("Work item");
}
