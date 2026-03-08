/**
 * Structured audit logging service.
 *
 * Every sensitive mutation must create an audit entry through this service.
 * Separates human-readable summary from structured machine fields.
 */
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

/**
 * Create a structured audit log entry.
 */
export async function createAuditEntry(entry: AuditEntry): Promise<void> {
  try {
    const details: Record<string, unknown> = {
      summary: entry.summary,
    };
    if (entry.before) details.before = entry.before;
    if (entry.after) details.after = entry.after;
    if (entry.metadata) details.metadata = entry.metadata;
    if (entry.ipAddress) details.ipAddress = entry.ipAddress;

    await prisma.auditLog.create({
      data: {
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        userId: entry.userId,
        details: JSON.stringify(details),
      },
    });

    logger.info(`Audit: ${entry.action} on ${entry.entityType}/${entry.entityId}`, {
      userId: entry.userId,
      action: entry.action,
    });
  } catch (error) {
    // Audit failures should never break the primary operation
    logger.error("Failed to create audit entry", {
      error: error instanceof Error ? error.message : String(error),
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
    });
  }
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
      details: JSON.parse(log.details || "{}"),
    })),
    total,
    page,
    pageSize,
  };
}
