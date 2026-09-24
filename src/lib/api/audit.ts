/**
 * Structured audit logging service.
 *
 * Every sensitive mutation must create an audit entry through this service.
 * Separates human-readable summary from structured machine fields.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export type AuditAction = string; // Flexible audit action type — all actions are valid

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId: string;
  userId: string;
  summary: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

export type AuditPhase = "recorded" | "requested" | "completed" | "failed";

/** Thrown when a fail-closed audit write fails: the action must not go ahead. */
export class AuditUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditUnavailableError";
  }
}

function auditData(entry: AuditEntry, phase: AuditPhase, correlationId: string | null, extra?: Record<string, unknown>) {
  const details: Record<string, unknown> = { summary: entry.summary };
  if (entry.before) details.before = entry.before;
  if (entry.after) details.after = entry.after;
  if (entry.metadata) details.metadata = entry.metadata;
  if (entry.ipAddress) details.ipAddress = entry.ipAddress;
  if (extra) Object.assign(details, extra);
  const actorUserId = typeof entry.metadata?.actorUserId === "string" ? entry.metadata.actorUserId : null;
  return {
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    userId: entry.userId,
    details: JSON.stringify(details),
    actorUserId,
    actorType: entry.userId === "system" && !actorUserId ? "system" : "user",
    correlationId,
    phase,
  };
}

/**
 * Create a structured audit log entry (fail-open: a failure is logged and the
 * caller carries on). For control-relevant actions use auditedAction, which
 * fails closed.
 */
export async function createAuditEntry(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({ data: auditData(entry, "recorded", null) });
    logger.info(`Audit: ${entry.action} on ${entry.entityType}/${entry.entityId}`, {
      userId: entry.userId,
      action: entry.action,
    });
  } catch (error) {
    logger.error("AUDIT_WRITE_FAILED: could not create audit entry", {
      error: error instanceof Error ? error.message : String(error),
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
    });
  }
}

/** Fail-closed write: throws AuditUnavailableError. */
export async function createAuditEntryStrict(entry: AuditEntry, phase: AuditPhase = "recorded", correlationId: string | null = null, extra?: Record<string, unknown>): Promise<void> {
  try {
    await prisma.auditLog.create({ data: auditData(entry, phase, correlationId, extra) });
  } catch (error) {
    logger.error("AUDIT_WRITE_FAILED: fail-closed audit write rejected the action", {
      error: error instanceof Error ? error.message : String(error),
      action: entry.action,
      entityType: entry.entityType,
      phase,
    });
    throw new AuditUnavailableError(`Audit write failed for ${entry.action}`);
  }
}

/**
 * Fail-closed audit around a control-relevant action. A "requested" entry is
 * written first; if it cannot be written the action does not run. Then the
 * outcome is appended as "completed" or "failed" with the same correlationId.
 * If the outcome entry itself cannot be written, the action has already
 * happened: that is logged as AUDIT_OUTCOME_MISSING and the unmatched
 * "requested" entry is raised by ALR-AUD-01.
 *
 * For creates, the requested entry cannot know the new id: pass opts.entityId
 * and the completed entry is recorded against the real id (the requested one
 * uses entry.entityId, e.g. "new"); both share the correlationId.
 */
export async function auditedAction<T>(
  entry: AuditEntry,
  run: (correlationId: string) => Promise<T>,
  outcome?: (result: T) => Record<string, unknown>,
  opts: { entityId?: (result: T) => string } = {},
): Promise<T> {
  const correlationId = randomUUID();
  await createAuditEntryStrict(entry, "requested", correlationId);
  let result: T;
  try {
    result = await run(correlationId);
  } catch (error) {
    await createAuditEntryStrict(entry, "failed", correlationId, { error: (error instanceof Error ? error.message : String(error)).slice(0, 500) })
      .catch(() => logger.error("AUDIT_OUTCOME_MISSING", { action: entry.action, correlationId, phase: "failed" }));
    throw error;
  }
  const completedEntry = opts.entityId ? { ...entry, entityId: opts.entityId(result) } : entry;
  await createAuditEntryStrict(completedEntry, "completed", correlationId, outcome ? { outcome: outcome(result) } : undefined)
    .catch(() => logger.error("AUDIT_OUTCOME_MISSING", { action: entry.action, correlationId, phase: "completed" }));
  return result;
}

/**
 * Convenience: audit a state transition (before/after).
 */
export async function auditStateChange(
  action: AuditAction,
  entityType: string,
  entityId: string,
  userId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  summary?: string,
): Promise<void> {
  await createAuditEntry({
    action,
    entityType,
    entityId,
    userId,
    summary: summary || `${action} on ${entityType}`,
    before,
    after,
  });
}

/**
 * Query audit logs with filters.
 */
export async function queryAuditLogs(filters: {
  userId?: string;
  action?: AuditAction;
  entityType?: string;
  entityId?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  pageSize?: number;
}) {
  const where: Record<string, unknown> = {};
  if (filters.userId) where.userId = filters.userId;
  if (filters.action) where.action = filters.action;
  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.entityId) where.entityId = filters.entityId;
  if (filters.startDate || filters.endDate) {
    where.createdAt = {
      ...(filters.startDate && { gte: filters.startDate }),
      ...(filters.endDate && { lte: filters.endDate }),
    };
  }

  const page = filters.page || 1;
  const pageSize = filters.pageSize || 50;

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    logs: logs.map((log) => ({
      ...log,
      details: typeof log.details === "string" ? JSON.parse(log.details || "{}") : (log.details ?? {}),
    })),
    total,
    page,
    pageSize,
  };
}
