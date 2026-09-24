/**
 * Metric formulas (spec §13.2). Pure functions over plain rows so each can be
 * unit-tested. Team and client level only (H4): no function here takes or
 * returns a person.
 *
 * Clocks start at source time (clockStartedAt). Business-hours calendars apply
 * only where the item's SlaPolicy.calendar says so; otherwise wall-clock
 * minutes are used.
 */

import { businessMinutesWith, nextBusinessDayEod, type BusinessCalendar } from "@/modules/alerting/calendar";

export type Clock = "ownership" | "first_response" | "resolution";

export interface MeasuredItem {
  clockStartedAt: Date;
  ownedAt: Date | null;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  /** Closed as "not a question" (closed_non_actionable). */
  nonActionable?: boolean;
}

export interface PolicyTargets {
  ownershipMins: number | null;
  firstRespMins: number | null;
  resolveMins: number | null;
  resolveRule?: string | null;
}

const WALL: BusinessCalendar = { is24x7: true, startMin: 0, endMin: 1440, holidays: new Set() };

export function elapsedMins(from: Date, to: Date, cal: BusinessCalendar = WALL): number {
  return businessMinutesWith(cal, from, to);
}

function stop(item: MeasuredItem, clock: Clock): Date | null {
  return clock === "ownership" ? item.ownedAt : clock === "first_response" ? item.firstResponseAt : item.resolvedAt;
}

/** Time to ownership / first response / resolution in minutes; null while the clock is still running. */
export function timeTo(item: MeasuredItem, clock: Clock, cal: BusinessCalendar = WALL): number | null {
  const end = stop(item, clock);
  return end ? elapsedMins(item.clockStartedAt, end, cal) : null;
}

export function targetFor(policy: PolicyTargets, clock: Clock, start: Date, cal: BusinessCalendar = WALL): number | null {
  if (clock === "ownership") return policy.ownershipMins;
  if (clock === "first_response") return policy.firstRespMins;
  if (policy.resolveMins != null) return policy.resolveMins;
  if (policy.resolveRule === "next_business_day_eod") return elapsedMins(start, nextBusinessDayEod(cal, start), cal);
  return null;
}

export interface Attainment {
  attained: number;
  measured: number;
  /** null when nothing was measured. */
  pct: number | null;
  /** Clock still running and target not yet passed: not counted either way. */
  pending: number;
  /** closed_non_actionable items: excluded from the denominator, reported separately. */
  excludedNonActionable: number;
  targetSet: boolean;
}

/**
 * SLA attainment %: share of items whose measured time is within the policy
 * target. An item whose clock is still running counts as missed once the
 * target has passed, and as pending before that.
 */
export function slaAttainment(
  rows: Array<{ item: MeasuredItem; policy: PolicyTargets; cal?: BusinessCalendar }>,
  clock: Clock,
  now: Date,
): Attainment {
  const out: Attainment = { attained: 0, measured: 0, pct: null, pending: 0, excludedNonActionable: 0, targetSet: false };
  for (const { item, policy, cal = WALL } of rows) {
    if (item.nonActionable) {
      out.excludedNonActionable++;
      continue;
    }
    const target = targetFor(policy, clock, item.clockStartedAt, cal);
    if (target == null) continue;
    out.targetSet = true;
    const measured = timeTo(item, clock, cal);
    if (measured == null) {
      if (elapsedMins(item.clockStartedAt, now, cal) > target) out.measured++;
      else out.pending++;
      continue;
    }
    out.measured++;
    if (measured <= target) out.attained++;
  }
  out.pct = out.measured ? Math.round((out.attained / out.measured) * 1000) / 10 : null;
  return out;
}

/** Breach count: distinct WorkItems with any *_breach SlaEvent in the period. */
export function breachCount(events: Array<{ workItemId: string; kind: string; at: Date }>, from: Date, to: Date): number {
  return new Set(events.filter((e) => e.kind.endsWith("_breach") && e.at >= from && e.at < to).map((e) => e.workItemId)).size;
}

export const BACKLOG_BANDS = ["<1h", "1–4h", "4–24h", "1–3d", ">3d"] as const;
export type BacklogBand = (typeof BACKLOG_BANDS)[number];

export function backlogBand(ageMins: number): BacklogBand {
  if (ageMins < 60) return "<1h";
  if (ageMins < 240) return "1–4h";
  if (ageMins < 1440) return "4–24h";
  if (ageMins < 3 * 1440) return "1–3d";
  return ">3d";
}

/** Backlog age: open items by age band. */
export function backlogAge(open: Array<{ clockStartedAt: Date }>, now: Date): Record<BacklogBand, number> {
  const out = Object.fromEntries(BACKLOG_BANDS.map((b) => [b, 0])) as Record<BacklogBand, number>;
  for (const i of open) out[backlogBand(elapsedMins(i.clockStartedAt, now))]++;
  return out;
}

/** Client effort (hours): Σ bucketMins / 60 by client. Labelled "logged effort". */
export function clientEffortHours(logs: Array<{ clientId: string | null; bucketMins: number }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of logs) {
    if (!l.clientId) continue;
    out.set(l.clientId, (out.get(l.clientId) ?? 0) + l.bucketMins / 60);
  }
  return out;
}

/** Logging coverage %: closed client requests with a TimeLog ÷ closed client requests. */
export function loggingCoverage(closedRequestIds: string[], loggedWorkItemIds: Set<string>): { covered: number; total: number; pct: number | null } {
  const covered = closedRequestIds.filter((id) => loggedWorkItemIds.has(id)).length;
  return { covered, total: closedRequestIds.length, pct: closedRequestIds.length ? Math.round((covered / closedRequestIds.length) * 1000) / 10 : null };
}

export interface AlertLoad {
  byRule: Record<string, number>;
  bySeverity: Record<string, number>;
  total: number;
  meanMinsToAcknowledge: number | null;
  autoResolvedShare: number | null;
}

/** Alert load: fired by rule and severity; mean time to acknowledge; auto-resolved share of resolved alerts. */
export function alertLoad(alerts: Array<{ ruleCode: string; severity: string; firstFiredAt: Date; acknowledgedAt: Date | null; resolvedAt: Date | null; autoResolvedAt: Date | null }>): AlertLoad {
  const byRule: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  const ackTimes: number[] = [];
  let resolved = 0;
  let auto = 0;
  for (const a of alerts) {
    byRule[a.ruleCode] = (byRule[a.ruleCode] ?? 0) + 1;
    bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1;
    if (a.acknowledgedAt) ackTimes.push(elapsedMins(a.firstFiredAt, a.acknowledgedAt));
    if (a.resolvedAt) {
      resolved++;
      if (a.autoResolvedAt) auto++;
    }
  }
  return {
    byRule,
    bySeverity,
    total: alerts.length,
    meanMinsToAcknowledge: ackTimes.length ? Math.round(ackTimes.reduce((s, v) => s + v, 0) / ackTimes.length) : null,
    autoResolvedShare: resolved ? Math.round((auto / resolved) * 1000) / 10 : null,
  };
}

export interface CheckCompletion {
  items: number;
  completed: number;
  onTime: number;
  onTimePct: number | null;
  skipped: number;
}

/** Check completion: on-time rate (completed, not skipped, by the due instant) and skipped count. */
export function checkCompletion(items: Array<{ status: string; completedAt: Date | null; dueAt: Date | null }>): CheckCompletion {
  const done = items.filter((i) => i.status === "pass" || i.status === "issues_found");
  const onTime = done.filter((i) => i.completedAt && (!i.dueAt || i.completedAt <= i.dueAt)).length;
  return {
    items: items.length,
    completed: done.length,
    onTime,
    onTimePct: items.length ? Math.round((onTime / items.length) * 1000) / 10 : null,
    skipped: items.filter((i) => i.status === "skipped").length,
  };
}

/** MTD break closure: share of breaks resolved within T+1 business day (end of the next business day). */
export function mtdClosure(breaks: Array<{ clockStartedAt: Date; resolvedAt: Date | null }>, cal: BusinessCalendar, now: Date): { withinT1: number; due: number; pct: number | null } {
  let withinT1 = 0;
  let due = 0;
  for (const b of breaks) {
    const deadline = nextBusinessDayEod(cal, b.clockStartedAt);
    if (!b.resolvedAt && now <= deadline) continue; // not yet due
    due++;
    if (b.resolvedAt && b.resolvedAt <= deadline) withinT1++;
  }
  return { withinT1, due, pct: due ? Math.round((withinT1 / due) * 1000) / 10 : null };
}

export type WindowOutcome = "on_time" | "failed" | "stuck" | "not_run" | "in_progress";

/** OES window outcome from the settlements seen for that window. */
export function windowOutcome(statuses: Array<{ mappedStatus: string | null; startedAt: Date | null }>, windowStart: Date, now: Date, stuckMins = 60): WindowOutcome {
  if (!statuses.length) return now.getTime() - windowStart.getTime() > 30 * 60_000 ? "not_run" : "in_progress";
  if (statuses.some((s) => s.mappedStatus === "failed" || s.mappedStatus === "partial")) return "failed";
  const running = statuses.filter((s) => s.mappedStatus !== "completed");
  if (!running.length) return "on_time";
  return running.some((s) => elapsedMins(s.startedAt ?? windowStart, now) > stuckMins) ? "stuck" : "in_progress";
}

/** Month-on-month change in percent; null when there is no previous value. */
export function trendPct(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// ── Client incident communication (spec v2 §13.2) ──

export type CadenceOutcome = "met" | "missed" | "pending";

/**
 * Update-cadence attainment for one client incident/risk: every gap between
 * client-visible updates (from the client request, through each posted
 * update, to resolution) must be within the cadence. An open item whose
 * current gap already exceeds the cadence has missed; otherwise it is pending.
 */
export function cadenceOutcome(clientRequestAt: Date, updates: Date[], resolvedAt: Date | null, cadenceMins: number, now: Date): CadenceOutcome {
  const points = [clientRequestAt, ...updates.filter((u) => u >= clientRequestAt && (!resolvedAt || u <= resolvedAt)).sort((a, b) => a.getTime() - b.getTime())];
  for (let i = 1; i < points.length; i++) if (elapsedMins(points[i - 1], points[i]) > cadenceMins) return "missed";
  const last = points[points.length - 1];
  if (resolvedAt) return elapsedMins(last, resolvedAt) > cadenceMins ? "missed" : "met";
  return elapsedMins(last, now) > cadenceMins ? "missed" : "pending";
}

export interface CadenceAttainment {
  met: number;
  missed: number;
  pending: number;
  pct: number | null;
  targetSet: boolean;
}

export function cadenceAttainment(outcomes: Array<CadenceOutcome | null>): CadenceAttainment {
  const out: CadenceAttainment = { met: 0, missed: 0, pending: 0, pct: null, targetSet: false };
  for (const o of outcomes) {
    if (o == null) continue;
    out.targetSet = true;
    out[o]++;
  }
  const measured = out.met + out.missed;
  out.pct = measured ? Math.round((out.met / measured) * 1000) / 10 : null;
  return out;
}

// ── Polling health (spec v2 §13.2) ──

export const POLL_SLOT_MINS = 5;

export interface PollingHealth {
  slots: number;
  onTime: number;
  failed: number;
  pct: number | null;
}

/**
 * Share of 5-minute polling slots with a cycle completed on time: a
 * successful cycle that started in the slot and finished before the slot
 * ended. Slots run from `from` (floored to the slot) to the last complete
 * slot before `to`.
 */
export function pollingHealth(cycles: Array<{ startedAt: Date; finishedAt: Date; ok: boolean }>, from: Date, to: Date, slotMins = POLL_SLOT_MINS): PollingHealth {
  const slotMs = slotMins * 60_000;
  const first = Math.floor(from.getTime() / slotMs);
  const last = Math.floor(to.getTime() / slotMs); // exclusive: the slot containing `to` is not complete
  const onTimeSlots = new Set<number>();
  const failedSlots = new Set<number>();
  for (const c of cycles) {
    const slot = Math.floor(c.startedAt.getTime() / slotMs);
    if (slot < first || slot >= last) continue;
    if (c.ok && c.finishedAt.getTime() < (slot + 1) * slotMs) onTimeSlots.add(slot);
    else if (!c.ok) failedSlots.add(slot);
  }
  const slots = Math.max(0, last - first);
  const onTime = onTimeSlots.size;
  return { slots, onTime, failed: [...failedSlots].filter((s) => !onTimeSlots.has(s)).length, pct: slots ? Math.round((onTime / slots) * 1000) / 10 : null };
}

// ── GX sprint UAT (spec §16.8) ──

export interface UatItem {
  createdAt: Date;
  resolvedAt: Date | null;
  outcome: string | null;
  defect: boolean;
  hasTicket: boolean;
}

/** First moment every item created by then had an outcome; null when never signed off. */
export function signOffAt(items: UatItem[]): Date | null {
  const times = items.map((i) => i.resolvedAt).filter((t): t is Date => !!t).sort((a, b) => a.getTime() - b.getTime());
  for (const t of times) {
    const existing = items.filter((i) => i.createdAt <= t);
    if (existing.length && existing.every((i) => i.outcome && i.resolvedAt && i.resolvedAt <= t)) return t;
  }
  return null;
}

export function sprintUat(items: UatItem[], prodPlannedAt: Date | null) {
  const signedOff = signOffAt(items);
  const withOutcome = items.filter((i) => i.outcome);
  const beforeProd = prodPlannedAt ? withOutcome.filter((i) => i.resolvedAt && i.resolvedAt <= prodPlannedAt).length : null;
  return {
    changeItems: items.length,
    uatTickets: items.filter((i) => i.hasTicket).length,
    completedBeforeProdPct: prodPlannedAt && items.length ? Math.round(((beforeProd ?? 0) / items.length) * 1000) / 10 : null,
    fails: items.filter((i) => i.outcome === "fail").length,
    defectsRaised: items.filter((i) => i.defect).length,
    addedAfterSignOff: signedOff ? items.filter((i) => i.createdAt > signedOff).length : 0,
  };
}
