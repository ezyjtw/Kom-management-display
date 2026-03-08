/**
 * Alert Domain Service
 *
 * Generates, routes, and manages the lifecycle of operational alerts.
 * Supports SLA breaches, ownership bouncing, quality/throughput drops,
 * and travel rule violations.
 *
 * Alert lifecycle: active -> acknowledged -> resolved
 * Alert routing: in_app, slack, email
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { AlertType, AlertData } from "@/types";

// ─── Constants ───

/** Number of ownership changes in 24h that triggers a bounce alert. */
const BOUNCE_ALERT_THRESHOLD = 2;

/** Window (ms) for bounce detection. */
const BOUNCE_WINDOW_MS = 24 * 60 * 60 * 1000;

// ─── Types ───

export type AlertStatus = "active" | "acknowledged" | "resolved";
export type AlertDestination = "in_app" | "slack" | "email";

export interface AlertFilters {
  type?: AlertType | AlertType[];
  status?: AlertStatus | AlertStatus[];
  priority?: string;
  threadId?: string;
  employeeId?: string;
  travelRuleCaseId?: string;
  incidentId?: string;
  destination?: AlertDestination;
  createdAfter?: Date;
  createdBefore?: Date;
}

export interface AlertPagination {
  page?: number;
  pageSize?: number;
  orderBy?: "createdAt" | "priority";
  order?: "asc" | "desc";
}

export interface CreateAlertInput {
  type: AlertType;
  priority?: string;
  message: string;
  threadId?: string;
  employeeId?: string;
  travelRuleCaseId?: string;
  incidentId?: string;
  destination?: AlertDestination;
}

export interface AlertRecord {
  id: string;
  type: string;
  priority: string;
  message: string;
  status: string;
  destination: string;
  threadId: string | null;
  employeeId: string | null;
  travelRuleCaseId: string | null;
  incidentId: string | null;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

export interface AlertTransitionResult {
  success: boolean;
  alert: AlertRecord;
  previousStatus: AlertStatus;
  newStatus: AlertStatus;
  error?: string;
}

/** Summary of a bulk SLA breach scan. */
export interface SlaBreachScanResult {
  threadsScanned: number;
  alertsCreated: number;
  alerts: AlertRecord[];
}

/** Summary of a bounce scan. */
export interface BounceScanResult {
  threadsScanned: number;
  bouncingThreads: number;
  alertsCreated: number;
  alerts: AlertRecord[];
}

// ─── Priority mapping by alert type ───

const DEFAULT_PRIORITY: Record<string, string> = {
  tto_breach: "P1",
  ttfa_breach: "P1",
  tsla_breach: "P2",
  ownership_bounce: "P2",
  ownership_change: "P3",
  mistakes_rising: "P2",
  throughput_drop: "P2",
  sla_slipping: "P2",
  travel_rule_missing_originator: "P2",
  travel_rule_missing_beneficiary: "P2",
  travel_rule_unmatched: "P2",
  travel_rule_sla_breach: "P1",
};

// ─── Service ───

export const alertService = {
  // ──────────────────────────────
  // Alert CRUD
  // ──────────────────────────────

  /**
   * List alerts with filtering and pagination.
   */
  async getAlerts(
    filters: AlertFilters = {},
    pagination: AlertPagination = {},
  ): Promise<{ alerts: AlertRecord[]; total: number }> {
    const where = buildAlertWhere(filters);
    const page = Math.max(1, pagination.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, pagination.pageSize ?? 25));

    const [alerts, total] = await Promise.all([
      prisma.alert.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { [pagination.orderBy ?? "createdAt"]: pagination.order ?? "desc" },
      }),
      prisma.alert.count({ where }),
    ]);

    return { alerts: alerts as AlertRecord[], total };
  },

  /**
   * Get a single alert by ID.
   */
  async getAlertById(id: string): Promise<AlertRecord | null> {
    const alert = await prisma.alert.findUnique({ where: { id } });
    return alert as AlertRecord | null;
  },

  /**
   * Create a new alert and route it to the appropriate destination.
   */
  async createAlert(input: CreateAlertInput): Promise<AlertRecord> {
    const priority = input.priority ?? DEFAULT_PRIORITY[input.type] ?? "P2";
    const destination = input.destination ?? determineDestination(input.type, priority);

    const alert = await prisma.alert.create({
      data: {
        type: input.type,
        priority,
        message: input.message,
        status: "active",
        destination,
        threadId: input.threadId ?? null,
        employeeId: input.employeeId ?? null,
        travelRuleCaseId: input.travelRuleCaseId ?? null,
        incidentId: input.incidentId ?? null,
      },
    });

    // Route to external channels if needed
    await routeAlert(alert as AlertRecord);

    logger.info("alertService.createAlert", {
      id: alert.id,
      type: input.type,
      priority,
      destination,
    });

    return alert as AlertRecord;
  },

  // ──────────────────────────────
  // Alert lifecycle
  // ──────────────────────────────

  /**
   * Acknowledge an active alert. Transitions from active -> acknowledged.
   */
  async acknowledgeAlert(
    alertId: string,
    acknowledgedBy: string,
  ): Promise<AlertTransitionResult> {
    return transitionAlert(alertId, "acknowledged", acknowledgedBy);
  },

  /**
   * Resolve an alert. Can transition from active -> resolved or
   * acknowledged -> resolved.
   */
  async resolveAlert(
    alertId: string,
    resolvedBy: string,
  ): Promise<AlertTransitionResult> {
    return transitionAlert(alertId, "resolved", resolvedBy);
  },

  // ──────────────────────────────
  // SLA breach alert generation
  // ──────────────────────────────

  /**
   * Scan all active threads for SLA breaches and generate alerts for
   * any that don't already have an active alert of the same type.
   */
  async generateSlaBreachAlerts(): Promise<SlaBreachScanResult> {
    const now = new Date();
    const activeThreads = await prisma.commsThread.findMany({
      where: { status: { notIn: ["Done", "Closed"] } },
      select: {
        id: true,
        subject: true,
        ownerUserId: true,
        ttoDeadline: true,
        ttfaDeadline: true,
        tslaDeadline: true,
      },
    });

    const alerts: AlertRecord[] = [];

    for (const thread of activeThreads) {
      const breachTypes: { type: AlertType; deadline: Date }[] = [];

      if (thread.ttoDeadline && thread.ttoDeadline < now) {
        breachTypes.push({ type: "tto_breach", deadline: thread.ttoDeadline });
      }
      if (thread.ttfaDeadline && thread.ttfaDeadline < now) {
        breachTypes.push({ type: "ttfa_breach", deadline: thread.ttfaDeadline });
      }
      if (thread.tslaDeadline && thread.tslaDeadline < now) {
        breachTypes.push({ type: "tsla_breach", deadline: thread.tslaDeadline });
      }

      for (const breach of breachTypes) {
        // Avoid duplicate active alerts
        const existing = await prisma.alert.findFirst({
          where: {
            threadId: thread.id,
            type: breach.type,
            status: "active",
          },
        });

        if (!existing) {
          const minutesOverdue = Math.round((now.getTime() - breach.deadline.getTime()) / 60000);
          const alert = await this.createAlert({
            type: breach.type,
            message: `SLA breach (${breach.type}): "${thread.subject}" overdue by ${minutesOverdue} minutes`,
            threadId: thread.id,
            employeeId: thread.ownerUserId ?? undefined,
          });
          alerts.push(alert);
        }
      }
    }

    logger.info("alertService.generateSlaBreachAlerts", {
      threadsScanned: activeThreads.length,
      alertsCreated: alerts.length,
    });

    return {
      threadsScanned: activeThreads.length,
      alertsCreated: alerts.length,
      alerts,
    };
  },

  // ──────────────────────────────
  // Ownership bounce alert generation
  // ──────────────────────────────

  /**
   * Scan for threads that have been reassigned excessively (>2 changes
   * within 24 hours) and generate bounce alerts.
   */
  async generateBounceAlerts(): Promise<BounceScanResult> {
    const windowStart = new Date(Date.now() - BOUNCE_WINDOW_MS);

    // Find threads with ownership changes in the window
    const recentChanges = await prisma.ownershipChange.findMany({
      where: { changedAt: { gte: windowStart } },
      select: { threadId: true },
    });

    // Group by thread and count
    const changeCounts = new Map<string, number>();
    for (const c of recentChanges) {
      changeCounts.set(c.threadId, (changeCounts.get(c.threadId) ?? 0) + 1);
    }

    const alerts: AlertRecord[] = [];
    let bouncingThreads = 0;

    for (const [threadId, count] of changeCounts) {
      if (count > BOUNCE_ALERT_THRESHOLD) {
        bouncingThreads++;

        // Avoid duplicate active alerts
        const existing = await prisma.alert.findFirst({
          where: {
            threadId,
            type: "ownership_bounce",
            status: "active",
          },
        });

        if (!existing) {
          const thread = await prisma.commsThread.findUnique({
            where: { id: threadId },
            select: { subject: true, ownerUserId: true },
          });

          const alert = await this.createAlert({
            type: "ownership_bounce",
            message: `Thread "${thread?.subject ?? threadId}" reassigned ${count} times in 24h (threshold: ${BOUNCE_ALERT_THRESHOLD})`,
            threadId,
            employeeId: thread?.ownerUserId ?? undefined,
          });
          alerts.push(alert);
        }
      }
    }

    logger.info("alertService.generateBounceAlerts", {
      threadsScanned: changeCounts.size,
      bouncingThreads,
      alertsCreated: alerts.length,
    });

    return {
      threadsScanned: changeCounts.size,
      bouncingThreads,
      alertsCreated: alerts.length,
      alerts,
    };
  },

  // ──────────────────────────────
  // Quality / throughput drop alerts
  // ──────────────────────────────

  /**
   * Generate alerts for employees whose quality or throughput scores
   * have dropped significantly between periods.
   *
   * @param currentPeriodId - The current scoring period
   * @param previousPeriodId - The previous scoring period for comparison
   * @param dropThreshold - Minimum score drop to trigger alert (default: 1.0 on 3-8 scale)
   */
  async generatePerformanceDropAlerts(
    currentPeriodId: string,
    previousPeriodId: string,
    dropThreshold = 1.0,
  ): Promise<{ alertsCreated: number; alerts: AlertRecord[] }> {
    const [currentScores, previousScores] = await Promise.all([
      prisma.categoryScore.findMany({
        where: { periodId: currentPeriodId, category: { in: ["quality", "daily_tasks"] } },
        include: { employee: { select: { id: true, name: true } } },
      }),
      prisma.categoryScore.findMany({
        where: { periodId: previousPeriodId, category: { in: ["quality", "daily_tasks"] } },
      }),
    ]);

    // Build previous scores map: employeeId:category -> score
    const prevMap = new Map<string, number>();
    for (const s of previousScores) {
      prevMap.set(`${s.employeeId}:${s.category}`, s.score);
    }

    const alerts: AlertRecord[] = [];

    for (const current of currentScores) {
      const prevScore = prevMap.get(`${current.employeeId}:${current.category}`);
      if (prevScore === undefined) continue;

      const delta = prevScore - current.score;
      if (delta >= dropThreshold) {
        const alertType: AlertType =
          current.category === "quality" ? "mistakes_rising" : "throughput_drop";

        const existing = await prisma.alert.findFirst({
          where: {
            employeeId: current.employeeId,
            type: alertType,
            status: "active",
          },
        });

        if (!existing) {
          const alert = await this.createAlert({
            type: alertType,
            message: `${current.employee.name}: ${current.category} score dropped by ${delta.toFixed(1)} (${prevScore.toFixed(1)} -> ${current.score.toFixed(1)})`,
            employeeId: current.employeeId,
          });
          alerts.push(alert);
        }
      }
    }

    logger.info("alertService.generatePerformanceDropAlerts", {
      currentPeriodId,
      previousPeriodId,
      alertsCreated: alerts.length,
    });

    return { alertsCreated: alerts.length, alerts };
  },

  // ──────────────────────────────
  // Alert statistics
  // ──────────────────────────────

  /**
   * Get a summary of alert counts by status and type.
   */
  async getAlertSummary(): Promise<{
    total: number;
    active: number;
    acknowledged: number;
    resolved: number;
    byType: Record<string, number>;
  }> {
    const [total, active, acknowledged, resolved, byType] = await Promise.all([
      prisma.alert.count(),
      prisma.alert.count({ where: { status: "active" } }),
      prisma.alert.count({ where: { status: "acknowledged" } }),
      prisma.alert.count({ where: { status: "resolved" } }),
      prisma.alert.groupBy({
        by: ["type"],
        where: { status: { in: ["active", "acknowledged"] } },
        _count: { id: true },
      }),
    ]);

    return {
      total,
      active,
      acknowledged,
      resolved,
      byType: Object.fromEntries(byType.map((g) => [g.type, g._count.id])),
    };
  },
};

// ─── Internal Helpers ───

/**
 * Transition an alert between lifecycle states.
 */
async function transitionAlert(
  alertId: string,
  targetStatus: AlertStatus,
  performedBy: string,
): Promise<AlertTransitionResult> {
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) {
    throw new Error(`Alert ${alertId} not found`);
  }

  const currentStatus = alert.status as AlertStatus;
  const validTransitions: Record<AlertStatus, AlertStatus[]> = {
    active: ["acknowledged", "resolved"],
    acknowledged: ["resolved"],
    resolved: [],
  };

  if (!validTransitions[currentStatus]?.includes(targetStatus)) {
    return {
      success: false,
      alert: alert as AlertRecord,
      previousStatus: currentStatus,
      newStatus: currentStatus,
      error: `Invalid transition: ${currentStatus} -> ${targetStatus}`,
    };
  }

  const updateData: Record<string, unknown> = { status: targetStatus };
  if (targetStatus === "acknowledged") updateData.acknowledgedAt = new Date();
  if (targetStatus === "resolved") updateData.resolvedAt = new Date();

  const updated = await prisma.alert.update({
    where: { id: alertId },
    data: updateData,
  });

  logger.info("alertService.transitionAlert", {
    alertId,
    from: currentStatus,
    to: targetStatus,
    performedBy,
  });

  return {
    success: true,
    alert: updated as AlertRecord,
    previousStatus: currentStatus,
    newStatus: targetStatus,
  };
}

/**
 * Determine the default routing destination based on alert type and priority.
 * P0/P1 alerts go to Slack for immediate visibility. Others stay in-app.
 */
function determineDestination(type: AlertType, priority: string): AlertDestination {
  if (priority === "P0") return "slack";
  if (priority === "P1" && type.includes("breach")) return "slack";
  return "in_app";
}

/**
 * Route an alert to external channels (Slack, email) if configured.
 * This is a placeholder for actual integration hooks.
 */
async function routeAlert(alert: AlertRecord): Promise<void> {
  if (alert.destination === "in_app") return;

  if (alert.destination === "slack") {
    logger.info("alertService.routeAlert: would send to Slack", {
      alertId: alert.id,
      type: alert.type,
      message: alert.message,
    });
    // Future: call Slack webhook
  }

  if (alert.destination === "email") {
    logger.info("alertService.routeAlert: would send email", {
      alertId: alert.id,
      type: alert.type,
    });
    // Future: call email service
  }
}

function buildAlertWhere(filters: AlertFilters): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  if (filters.type) {
    where.type = Array.isArray(filters.type) ? { in: filters.type } : filters.type;
  }
  if (filters.status) {
    where.status = Array.isArray(filters.status) ? { in: filters.status } : filters.status;
  }
  if (filters.priority) where.priority = filters.priority;
  if (filters.threadId) where.threadId = filters.threadId;
  if (filters.employeeId) where.employeeId = filters.employeeId;
  if (filters.travelRuleCaseId) where.travelRuleCaseId = filters.travelRuleCaseId;
  if (filters.incidentId) where.incidentId = filters.incidentId;
  if (filters.destination) where.destination = filters.destination;

  if (filters.createdAfter || filters.createdBefore) {
    const createdAt: Record<string, Date> = {};
    if (filters.createdAfter) createdAt.gte = filters.createdAfter;
    if (filters.createdBefore) createdAt.lte = filters.createdBefore;
    where.createdAt = createdAt;
  }

  return where;
}
