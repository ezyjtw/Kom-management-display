/**
 * Internal security alerts over the audit log (spec §17.7). ALR-SEC-03 and
 * ALR-SEC-04 are raised immediately by src/modules/security/events.ts.
 */

import { prisma } from "@/lib/prisma";
import { SECURITY_ACTIONS } from "@/modules/security/actions";
import { numParam, type AlertCandidate, type EvaluatorContext } from "@/modules/alerting/types";

/** ALR-SEC-01: more than N permission denials for one user within the window. */
export async function evaluateRepeatedDenials(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const threshold = numParam(ctx.params, "threshold", 10);
  const windowMins = numParam(ctx.params, "windowMins", 15);
  const rows = await prisma.auditLog.findMany({
    where: { action: SECURITY_ACTIONS.permissionDenied, createdAt: { gte: new Date(ctx.now.getTime() - windowMins * 60_000) } },
    select: { actorUserId: true, entityId: true },
    take: 10_000,
  });
  const byUser = new Map<string, string[]>();
  for (const r of rows) {
    const key = r.actorUserId ?? "anonymous";
    byUser.set(key, [...(byUser.get(key) ?? []), r.entityId]);
  }
  const out: AlertCandidate[] = [];
  for (const [user, paths] of byUser) {
    if (paths.length <= threshold) continue;
    const distinct = [...new Set(paths)];
    out.push({
      dedupeKey: user,
      severity: "high",
      title: `Repeated authorisation failures (${paths.length} in ${windowMins} min)`,
      detail: `User ${user} was refused ${paths.length} times in ${windowMins} minutes on ${distinct.length} route(s): ${distinct.slice(0, 10).join(", ")}. Check whether this is a misconfigured role or probing.`,
      workItemSeed: { kind: "internal_task", taskCode: "SEC" },
    });
  }
  return out;
}

/**
 * Audit entity types whose change is privileged configuration (spec §17.7):
 * alert rules, SLA policies, impact rules and other reference tables, client
 * and channel mappings, settings, feature flags and roles.
 */
export const PRIVILEGED_ENTITY_TYPES = [
  "alert_rule",
  "sla_policy",
  "reference_data",
  "client",
  "slack_channel",
  "jira_project",
  "app_setting",
  "feature_flag",
  "user",
] as const;

/** ALR-SEC-02: one informational, ticketed alert per privileged configuration change. */
export async function evaluatePrivilegedChange(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const lookbackMins = numParam(ctx.params, "lookbackMins", 60);
  const rows = await prisma.auditLog.findMany({
    where: {
      entityType: { in: [...PRIVILEGED_ENTITY_TYPES] },
      // One entry per change: the outcome of an audited action, or a single recorded entry.
      phase: { in: ["recorded", "completed"] },
      createdAt: { gte: new Date(ctx.now.getTime() - lookbackMins * 60_000) },
    },
    select: { id: true, action: true, entityType: true, entityId: true, actorUserId: true, userId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  return rows.map((r) => ({
    dedupeKey: r.id,
    severity: "medium" as const,
    title: `Privileged configuration change: ${r.action}`,
    detail: `${r.entityType} ${r.entityId} changed (${r.action}) by ${r.actorUserId ?? r.userId} at ${r.createdAt.toISOString()}. Informational: confirm the change was expected.`,
    workItemSeed: { kind: "internal_task" as const, taskCode: "SEC" },
  }));
}

/** ALR-SEC-05: repeated 401/403 from one connector host within the window. */
export async function evaluateCredentialFailures(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const threshold = numParam(ctx.params, "threshold", 3);
  const windowMins = numParam(ctx.params, "windowMins", 30);
  const rows = await prisma.auditLog.findMany({
    where: { action: SECURITY_ACTIONS.credentialFailure, createdAt: { gte: new Date(ctx.now.getTime() - windowMins * 60_000) } },
    select: { entityId: true },
    take: 10_000,
  });
  const byHost = new Map<string, number>();
  for (const r of rows) byHost.set(r.entityId, (byHost.get(r.entityId) ?? 0) + 1);
  return [...byHost]
    .filter(([, n]) => n >= threshold)
    .map(([host, n]) => ({
      dedupeKey: host,
      severity: "high" as const,
      title: `Integration credential failures: ${host}`,
      detail: `${host} answered 401/403 ${n} times in ${windowMins} minutes. The credential may have been revoked, rotated or misused: follow the revoke-first procedure in docs/phase1/credentials.md.`,
      workItemSeed: { kind: "internal_task" as const, taskCode: "SEC" },
    }));
}
