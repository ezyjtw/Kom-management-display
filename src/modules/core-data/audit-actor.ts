import type { AuthUser } from "@/lib/auth-user";

/** AuditLog.userId references Employee; users without one are recorded as the system actor plus their user id. */
export function auditActor(auth: AuthUser): { userId: string; metadata: Record<string, unknown> } {
  return {
    userId: auth.employeeId ?? "system",
    metadata: { actorUserId: auth.id, actorEmail: auth.email },
  };
}
