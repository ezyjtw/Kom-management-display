import type { ThreadPriority, ThreadStatus, SlaThresholds, SlaStatus } from "@/types";

/**
 * Default SLA thresholds in minutes.
 */
export const DEFAULT_SLA_THRESHOLDS: SlaThresholds = {
  tto: { P0: 5, P1: 30, P2: 120, P3: 480 },
  ttfa: { P0: 10, P1: 60, P2: 240, P3: 960 },
  tsla: {
    InProgress: 120,
    WaitingExternal: 480,
    default: 240,
  },
};

/**
 * Compute SLA status for a thread.
 */
export function computeSlaStatus(thread: {
  createdAt: Date | string;
  ownerUserId: string | null;
  lastActionAt: Date | string | null;
  status: string;
  priority: string;
  ttoDeadline?: Date | string | null;
  ttfaDeadline?: Date | string | null;
  tslaDeadline?: Date | string | null;
}): SlaStatus {
  const now = new Date();
  const priority = thread.priority as ThreadPriority;
  const status = thread.status as ThreadStatus;
  const thresholds = DEFAULT_SLA_THRESHOLDS;

  // TTO: time from creation to ownership
  let ttoRemaining: number | null = null;
  let isTtoBreached = false;
  if (!thread.ownerUserId && status === "Unassigned") {
    const created = new Date(thread.createdAt);
    const deadlineMs = thresholds.tto[priority] * 60 * 1000;
    const elapsed = now.getTime() - created.getTime();
    ttoRemaining = Math.round((deadlineMs - elapsed) / 60000);
    isTtoBreached = ttoRemaining < 0;
  }

  // TTFA: time from assignment to first action
  let ttfaRemaining: number | null = null;
  let isTtfaBreached = false;
  if (thread.ownerUserId && !thread.lastActionAt && status === "Assigned") {
    const deadline = thread.ttfaDeadline ? new Date(thread.ttfaDeadline) : null;
    if (deadline) {
      ttfaRemaining = Math.round((deadline.getTime() - now.getTime()) / 60000);
      isTtfaBreached = ttfaRemaining < 0;
    }
  }

  // TSLA: time since last action
  let tslaRemaining: number | null = null;
  let isTslaBreached = false;
  if (
    thread.lastActionAt &&
    !["Done", "Closed", "Unassigned"].includes(status)
  ) {
    const tslaThreshold =
      status === "InProgress"
        ? thresholds.tsla.InProgress
        : status === "WaitingExternal"
        ? thresholds.tsla.WaitingExternal
        : thresholds.tsla.default;

    const lastAction = new Date(thread.lastActionAt);
    const deadlineMs = tslaThreshold * 60 * 1000;
    const elapsed = now.getTime() - lastAction.getTime();
    tslaRemaining = Math.round((deadlineMs - elapsed) / 60000);
    isTslaBreached = tslaRemaining < 0;
  }

  return {
    ttoRemaining,
    ttfaRemaining,
    tslaRemaining,
    isTtoBreached,
    isTtfaBreached,
    isTslaBreached,
  };
}

/**
 * Compute TTO deadline from thread creation.
 */
export function computeTtoDeadline(createdAt: Date, priority: ThreadPriority): Date {
  const minutes = DEFAULT_SLA_THRESHOLDS.tto[priority];
  return new Date(createdAt.getTime() + minutes * 60 * 1000);
}

/**
 * Compute TTFA deadline from assignment time.
 */
export function computeTtfaDeadline(assignedAt: Date, priority: ThreadPriority): Date {
  const minutes = DEFAULT_SLA_THRESHOLDS.ttfa[priority];
  return new Date(assignedAt.getTime() + minutes * 60 * 1000);
}

/**
 * Format remaining minutes as human-readable string.
 */
export function formatSlaRemaining(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 0) {
    const abs = Math.abs(minutes);
    if (abs >= 60) return `Overdue by ${Math.floor(abs / 60)}h ${abs % 60}m`;
    return `Overdue by ${abs}m`;
  }
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}m`;
}

/**
 * Check if a thread has excessive ownership bouncing (>2 changes in 24h).
 */
export function isExcessiveBouncing(
  ownershipChanges: { changedAt: Date | string }[]
): boolean {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentChanges = ownershipChanges.filter(
    (c) => new Date(c.changedAt) > dayAgo
  );
  return recentChanges.length > 2;
}
