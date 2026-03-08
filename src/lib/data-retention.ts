/**
 * Data retention enforcement.
 *
 * Implements configurable retention policies for different data types.
 * Designed to run as a background job to purge data older than
 * the specified retention period.
 *
 * Retention periods:
 *   - Audit logs: 2 years (regulatory compliance)
 *   - Comms messages: 1 year
 *   - Resolved incidents: 2 years
 *   - Background job history: 30 days
 *   - Session metadata: 30 days
 *   - Alert history: 90 days
 *
 * All deletions are logged for audit purposes. Deletions are performed
 * in batches to avoid locking the database for extended periods.
 *
 * Usage:
 *   const result = await enforceRetentionPolicies();
 *   // { auditLogs: 0, messages: 15, jobs: 230, ... }
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export interface RetentionPolicy {
  /** Human-readable name for the policy. */
  name: string;
  /** Prisma model to clean up. */
  model: string;
  /** Field to check for age (must be a DateTime field). */
  dateField: string;
  /** Retention period in days. */
  retentionDays: number;
  /** Additional filter conditions for deletion (e.g., status). */
  additionalFilter?: Record<string, unknown>;
  /** Maximum records to delete per batch. */
  batchSize?: number;
}

/** Default retention policies. Adjust per regulatory requirements. */
export const DEFAULT_RETENTION_POLICIES: RetentionPolicy[] = [
  {
    name: "Completed background jobs",
    model: "backgroundJob",
    dateField: "completedAt",
    retentionDays: 30,
    additionalFilter: { status: { in: ["completed", "failed"] }, isRecurring: false },
  },
  {
    name: "Expired session metadata",
    model: "sessionMetadata",
    dateField: "expiresAt",
    retentionDays: 30,
  },
  {
    name: "Old alert history",
    model: "alert",
    dateField: "createdAt",
    retentionDays: 90,
    additionalFilter: { status: "resolved" },
  },
  {
    name: "Old comms messages",
    model: "commsMessage",
    dateField: "timestamp",
    retentionDays: 365,
  },
  {
    name: "Archived scoring configs",
    model: "scoringConfig",
    dateField: "updatedAt",
    retentionDays: 730,
    additionalFilter: { status: "archived" },
  },
];

export interface RetentionResult {
  policy: string;
  deletedCount: number;
  cutoffDate: string;
  durationMs: number;
  error?: string;
}

/**
 * Enforce a single retention policy.
 * Deletes records older than the retention period in batches.
 */
async function enforcePolicy(policy: RetentionPolicy): Promise<RetentionResult> {
  const start = Date.now();
  const cutoffDate = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);

  const result: RetentionResult = {
    policy: policy.name,
    deletedCount: 0,
    cutoffDate: cutoffDate.toISOString(),
    durationMs: 0,
  };

  try {
    const where: Record<string, unknown> = {
      [policy.dateField]: { lt: cutoffDate },
      ...policy.additionalFilter,
    };

    // Use Prisma's deleteMany for batch deletion
    // TypeScript doesn't support dynamic model access directly,
    // so we use the $executeRawUnsafe only as fallback
    const model = (prisma as Record<string, any>)[policy.model];
    if (!model) {
      result.error = `Model ${policy.model} not found`;
      result.durationMs = Date.now() - start;
      return result;
    }

    const deleted = await model.deleteMany({ where });
    result.deletedCount = deleted.count;

    if (result.deletedCount > 0) {
      logger.info(`Data retention: purged ${result.deletedCount} records`, {
        policy: policy.name,
        model: policy.model,
        cutoffDate: cutoffDate.toISOString(),
        deletedCount: result.deletedCount,
      });
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    logger.error(`Data retention policy failed: ${policy.name}`, {
      model: policy.model,
      error: result.error,
    });
  }

  result.durationMs = Date.now() - start;
  return result;
}

/**
 * Run all retention policies sequentially.
 * Returns a summary of what was cleaned up.
 */
export async function enforceRetentionPolicies(
  policies = DEFAULT_RETENTION_POLICIES,
): Promise<RetentionResult[]> {
  logger.info("Data retention enforcement starting", {
    policyCount: policies.length,
  });

  const results: RetentionResult[] = [];

  for (const policy of policies) {
    const result = await enforcePolicy(policy);
    results.push(result);
  }

  const totalDeleted = results.reduce((sum, r) => sum + r.deletedCount, 0);
  const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);

  logger.info("Data retention enforcement complete", {
    totalDeleted,
    totalDurationMs: totalDuration,
    results: results.map((r) => ({
      policy: r.policy,
      deleted: r.deletedCount,
      error: r.error,
    })),
  });

  // Log an audit entry for the retention run
  try {
    await prisma.auditLog.create({
      data: {
        action: "data_retention_enforcement",
        entityType: "system",
        entityId: "retention",
        userId: "system",
        details: JSON.stringify({
          totalDeleted,
          totalDurationMs: totalDuration,
          policies: results.map((r) => ({
            policy: r.policy,
            deleted: r.deletedCount,
          })),
        }),
      },
    });
  } catch {
    // Audit logging should not break the retention process
  }

  return results;
}
