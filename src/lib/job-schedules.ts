/**
 * Recurring job schedules (load review, Phase 12n). Defaults live here; an
 * admin can override the cadence of most jobs with the `jobs.schedules`
 * setting, and the worker applies changes within SCHEDULE_SYNC_MS without a
 * restart.
 *
 * - Slack and shared-mailbox polling are fixed at every 5 minutes, 24/7
 *   (standing rule, spec §6.1) and cannot be overridden.
 * - An override must be a valid 5-field cron (optionally prefixed
 *   `TZ=<zone> `) that runs at most once a minute and at least once a day.
 */
import { CronExpressionParser } from "cron-parser";

export const DEFAULT_JOB_SCHEDULES = {
  sync_jira: "*/2 * * * *",          // spec §8.2: every 2 min, updated >= -5m
  check_staking: "0 */6 * * *",
  check_confirmations: "*/5 * * * *",
  cleanup_sessions: "0 2 * * *",
  // Spec §6.1: every registered Slack channel and shared mailbox, every 5 minutes, 24/7. Never paused out of hours.
  sync_slack: "*/5 * * * *",
  sync_mail: "*/5 * * * *",
  // Pending requests every 2 min: the fastest alert clock on them is 10 min (load review, Phase 12n).
  custody_poll_requests: "*/2 * * * *",
  custody_poll_transactions: "*/2 * * * *",
  custody_poll_collateral: "*/10 * * * *",
  custody_poll_audit_logs: "*/5 * * * *",
  custody_poll_eod_balances: "0 7 * * *",
  custody_poll_staking: "30 7 * * *",
  custody_poll_stakes: "45 7 * * *",
  graph_teams_sync: "*/5 * * * *",
  poll_status_pages: "*/10 * * * *",  // no-op unless module.status_pages
  report_unticketed: "TZ=Europe/London 30 8 * * *", // spec §10.3: 08:30 UK
  reconcile_tickets: "15 * * * *",    // spec §10.3: hourly
  incident_log_overdue: "5 * * * *",  // spec §10.4
  evaluate_alerts: "*/1 * * * *",     // spec §11.1: every 60 s; rules may declare their own cadence
  alert_digest: "TZ=Europe/London 0 8 * * *", // spec §11.3: daily digest of medium config rules
  poll_risk_signals: "*/1 * * * *",   // spec §11.4
  generate_daily_checks: "*/15 * * * *", // spec §12: today's items (idempotent; per-window items as windows open)
  collect_check_evidence: "*/10 * * * *", // spec §12 (b): automated data pulls
  mtd_autoclose: "20 * * * *",        // spec §12 CHK-02: close the daily OPS MTD ticket
  poll_client_ticket_comments: "*/5 * * * *", // spec §9.7: client portal comments
  platform_sprint_intake: "20 * * * *", // spec §16.1: hourly check; full intake on platform.sprint_intake.cron or CHG changes
  // Retention: runs daily and records its outcome; deletes nothing until retention.enabled is set (CONFIRM-RETENTION).
  data_retention: "TZ=Europe/London 0 3 * * *",
  morning_handover: "TZ=Europe/London */15 9-11 * * 1-5", // spec §14.3: from 09:00 UK post handovers, retry failed tickets, remind when missing
} as const;

export type ScheduledJobType = keyof typeof DEFAULT_JOB_SCHEDULES;

/** Standing rule: never slower or paused (spec §6.1). */
export const FIXED_SCHEDULE_JOBS: readonly ScheduledJobType[] = ["sync_slack", "sync_mail"];

/** How often the worker re-reads overrides. */
export const SCHEDULE_SYNC_MS = 5 * 60_000;

function parse(cron: string, from: Date) {
  const m = /^TZ=(\S+)\s+(.+)$/.exec(cron.trim());
  const [tz, expr] = m ? [m[1], m[2]] : ["UTC", cron.trim()];
  if (expr.split(/\s+/).length !== 5) throw new Error("use a 5-field cron expression (no seconds)");
  return CronExpressionParser.parse(expr, { currentDate: from, tz });
}

/** Shortest gap between runs over the next day, in minutes (for heartbeat expectations). */
export function scheduleIntervalMins(cron: string, from = new Date("2026-01-05T00:00:00Z")): number {
  const it = parse(cron, from);
  let prev = it.next().toDate().getTime();
  let min = Infinity;
  for (let i = 0; i < 1500; i++) {
    const next = it.next().toDate().getTime();
    min = Math.min(min, (next - prev) / 60_000);
    prev = next;
    if (next - from.getTime() > 8 * 86_400_000) break;
  }
  return min;
}

/** Why an override is refused, or null when it is acceptable. */
export function scheduleOverrideProblem(type: string, cron: string): string | null {
  if (!(type in DEFAULT_JOB_SCHEDULES)) return `unknown job ${type}`;
  if (FIXED_SCHEDULE_JOBS.includes(type as ScheduledJobType)) return `${type} is fixed at every 5 minutes, 24/7`;
  try {
    const mins = scheduleIntervalMins(cron);
    if (mins < 1) return "runs more than once a minute";
    if (mins > 24 * 60) return "runs less than once a day";
  } catch (error) {
    return `invalid cron: ${error instanceof Error ? error.message : String(error)}`;
  }
  return null;
}

/** Defaults with valid overrides applied; invalid overrides are ignored. */
export function effectiveSchedules(overrides: Record<string, string> = {}): Record<ScheduledJobType, string> {
  const out = { ...DEFAULT_JOB_SCHEDULES } as Record<ScheduledJobType, string>;
  for (const [type, cron] of Object.entries(overrides)) {
    if (!scheduleOverrideProblem(type, cron)) out[type as ScheduledJobType] = cron.trim();
  }
  return out;
}
