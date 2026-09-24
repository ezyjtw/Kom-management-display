/**
 * SLA engine (spec §11.2, ALR-SLA-01..06): ownership, first response and
 * resolution clocks for every open WorkItem with an SlaPolicy. Warn at
 * `warnAtPct` (medium), breach at 100% (high; P0 and P1 critical). Clocks run
 * on the policy's calendar. A P0/P1 breach on a client request opens an IAI
 * draft (spec §10.4).
 */

import type { SlaPolicy, WorkItem } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { businessMinutesWith, loadCalendar, nextBusinessDayEod, type BusinessCalendar } from "@/modules/alerting/calendar";
import { createIaiDraft, IAI_TRIGGER_CLIENT_SLA_BREACH } from "@/modules/iai/drafts";
import type { AlertCandidate, EvaluatorContext } from "@/modules/alerting/types";

export type SlaClock = "ownership" | "first_response" | "resolution";
export type SlaPhase = "warn" | "breach";

export const SLA_RULES: Record<string, { clock: SlaClock; phase: SlaPhase }> = {
  "ALR-SLA-01": { clock: "ownership", phase: "warn" },
  "ALR-SLA-02": { clock: "ownership", phase: "breach" },
  "ALR-SLA-03": { clock: "first_response", phase: "warn" },
  "ALR-SLA-04": { clock: "first_response", phase: "breach" },
  "ALR-SLA-05": { clock: "resolution", phase: "warn" },
  "ALR-SLA-06": { clock: "resolution", phase: "breach" },
};

const OPEN = ["open", "owned", "waiting_client", "waiting_vendor", "waiting_internal"] as const;

/** Elapsed fraction (0..) of a clock, or null when the clock has no target or has stopped. */
export function clockProgress(item: WorkItem, policy: SlaPolicy, clock: SlaClock, cal: BusinessCalendar, now: Date): { pct: number; elapsedMins: number; targetMins: number } | null {
  const stoppedAt = clock === "ownership" ? item.ownedAt : clock === "first_response" ? item.firstResponseAt : item.resolvedAt;
  if (stoppedAt) return null;
  // A client portal comment restarts the first-response clock (spec §9.7).
  const meta = (item.metadata ?? {}) as Record<string, unknown>;
  const start = clock === "first_response" && typeof meta.firstResponseClockStartedAt === "string" ? new Date(meta.firstResponseClockStartedAt) : item.clockStartedAt;
  const elapsedMins = businessMinutesWith(cal, start, now);
  let targetMins: number | null = clock === "ownership" ? policy.ownershipMins : clock === "first_response" ? policy.firstRespMins : policy.resolveMins;
  if (clock === "resolution" && targetMins == null && policy.resolveRule === "next_business_day_eod") {
    targetMins = businessMinutesWith(cal, item.clockStartedAt, nextBusinessDayEod(cal, item.clockStartedAt));
  }
  if (targetMins == null || targetMins <= 0) return null;
  return { pct: (elapsedMins / targetMins) * 100, elapsedMins, targetMins };
}

const LABEL: Record<SlaClock, string> = { ownership: "ownership", first_response: "first response", resolution: "resolution" };

export function slaEvaluator(code: string) {
  const { clock, phase } = SLA_RULES[code];
  return async (ctx: EvaluatorContext): Promise<AlertCandidate[]> => {
    const items = await prisma.workItem.findMany({
      where: { state: { in: [...OPEN] }, slaPolicyId: { not: null }, slaPolicy: { isActive: true } },
      include: { slaPolicy: true },
      take: 5000,
    });
    const calendars = new Map<string, BusinessCalendar>();
    const out: AlertCandidate[] = [];
    for (const item of items) {
      const policy = item.slaPolicy!;
      let cal = calendars.get(policy.calendar);
      if (!cal) {
        const from = new Date(Math.min(...items.map((i) => i.clockStartedAt.getTime())));
        cal = await loadCalendar(policy.calendar, from, new Date(ctx.now.getTime() + 7 * 86_400_000));
        calendars.set(policy.calendar, cal);
      }
      const p = clockProgress(item, policy, clock, cal, ctx.now);
      if (!p) continue;
      const hit = phase === "breach" ? p.pct >= 100 : p.pct >= policy.warnAtPct && p.pct < 100;
      if (!hit) continue;
      const urgent = item.priority === "P0" || item.priority === "P1";
      out.push({
        dedupeKey: item.id,
        severity: phase === "warn" ? "medium" : urgent ? "critical" : "high",
        title: `SLA ${LABEL[clock]} ${phase === "warn" ? "warning" : "breach"} (${policy.code})`,
        detail: `${item.ticketKey ?? item.title}: ${Math.round(p.elapsedMins)} of ${p.targetMins} minutes used for ${LABEL[clock]} (${Math.round(p.pct)}%, priority ${item.priority}).`,
        workItemId: item.id,
        priority: item.priority,
      });
    }
    return out;
  };
}

/** Record the SlaEvent and, for P0/P1 client-request breaches, open an IAI draft. */
export function onSlaRaised(code: string) {
  const { clock, phase } = SLA_RULES[code];
  return async (_alertId: string, candidate: AlertCandidate): Promise<void> => {
    if (!candidate.workItemId) return;
    try {
      await prisma.slaEvent.create({ data: { workItemId: candidate.workItemId, kind: `${clock}_${phase}`, at: new Date() } });
      if (phase === "breach" && (candidate.priority === "P0" || candidate.priority === "P1")) {
        const item = await prisma.workItem.findUnique({ where: { id: candidate.workItemId }, select: { kind: true } });
        if (item?.kind === "client_request") await createIaiDraft(candidate.workItemId, IAI_TRIGGER_CLIENT_SLA_BREACH);
      }
    } catch (error) {
      logger.warn("SLA event side effects failed", { code, error: error instanceof Error ? error.message : String(error) });
    }
  };
}
