/**
 * Definition sync and item generation (spec §12 common template, a).
 * Daily checks run on UK business days; weekly checks on their weekday;
 * CHK-10 once per settlement window (OesWindow). Event and continuous tasks
 * have no items: their work is tracked as WorkItems by task code.
 */

import { Prisma, type DailyCheckDefinition } from "@prisma/client";
import { CronExpressionParser } from "cron-parser";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { isBusinessTimeWith, loadCalendar, londonParts } from "@/modules/alerting/calendar";
import { confluencePlaceholder, DEFINITIONS } from "@/modules/daily-checks/definitions";

export const SYSTEM_OPERATOR = "system";

/** Insert definitions missing from the table. Admin edits to existing rows are never overwritten. */
export async function syncDailyCheckDefinitions(): Promise<number> {
  const existing = new Set((await prisma.dailyCheckDefinition.findMany({ select: { code: true } })).map((d) => d.code));
  let created = 0;
  for (const d of DEFINITIONS) {
    if (existing.has(d.code)) continue;
    try {
      await prisma.dailyCheckDefinition.create({
        data: {
          code: d.code,
          name: d.name,
          team: d.team,
          frequency: d.frequency,
          dueByLocal: d.dueByLocal,
          evidenceSpec: { ...d.evidenceSpec, ...(d.weekday ? { weekday: d.weekday } : {}) } as Prisma.InputJsonValue,
          ticketProject: d.ticketProject,
          confluenceUrl: confluencePlaceholder(d.confluenceTitle),
          kind: d.kind,
          requiredFlag: d.requiredFlag ?? null,
          restricted: d.restricted ?? false,
        },
      });
      created++;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
  }
  return created;
}

/** ISO week key, e.g. "2026-W39", for a London calendar date. */
export function isoWeekKey(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function weekdayOf(def: Pick<DailyCheckDefinition, "evidenceSpec">): number {
  const spec = (def.evidenceSpec ?? {}) as Record<string, unknown>;
  return typeof spec.weekday === "number" ? spec.weekday : 1;
}

export interface Period {
  key: string;
  /** Instant the period's work is due (window start for per-cycle checks). */
  startsAt: Date;
  label: string;
}

/** The periods a definition has today (London), or [] when nothing is due. */
export async function periodsFor(def: DailyCheckDefinition, now: Date): Promise<Period[]> {
  const today = londonParts(now);
  const cal = await loadCalendar("business_uk", now, now);
  const businessDay = isBusinessTimeWith({ ...cal, startMin: 0, endMin: 1440 }, now);

  if (def.frequency === "daily") return businessDay ? [{ key: today.date, startsAt: now, label: today.date }] : [];
  if (def.frequency === "weekly") {
    const isoWeekday = today.weekday === 0 ? 7 : today.weekday;
    return isoWeekday === weekdayOf(def) ? [{ key: isoWeekKey(today.date), startsAt: now, label: isoWeekKey(today.date) }] : [];
  }
  if (def.frequency === "per_cycle") {
    const windows = await prisma.oesWindow.findMany({ where: { isActive: true } });
    const out: Period[] = [];
    const dayStart = new Date(`${today.date}T00:00:00Z`);
    for (const w of windows) {
      try {
        const it = CronExpressionParser.parse(w.cron, { currentDate: new Date(dayStart.getTime() - 1000), endDate: now, tz: w.referenceTz });
        while (it.hasNext()) {
          const start = it.next().toDate();
          const hhmm = start.toISOString().slice(11, 16);
          out.push({ key: `${today.date}:${w.exchange.toLowerCase()}:${hhmm}Z`, startsAt: start, label: `${w.exchange} ${hhmm}Z` });
        }
      } catch (error) {
        logger.warn("Invalid OES window cron", { exchange: w.exchange, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return out;
  }
  return [];
}

async function runFor(date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  return (
    (await prisma.dailyCheckRun.findFirst({ where: { date: day, operatorId: SYSTEM_OPERATOR } })) ??
    (await prisma.dailyCheckRun.create({ data: { date: day, operatorId: SYSTEM_OPERATOR } }))
  );
}

/** Job `generate_daily_checks`: make sure today's items exist for every active definition. */
export async function generateDailyItems(now = new Date()): Promise<{ created: number }> {
  await syncDailyCheckDefinitions();
  const defs = await prisma.dailyCheckDefinition.findMany({ where: { isActive: true } });
  const today = londonParts(now).date;
  let created = 0;
  let runId: string | null = null;

  for (const def of defs) {
    if (def.requiredFlag && !(await isFeatureEnabled(def.requiredFlag))) continue;
    for (const period of await periodsFor(def, now)) {
      const exists = await prisma.dailyCheckItem.findUnique({ where: { definitionCode_periodKey: { definitionCode: def.code, periodKey: period.key } } });
      if (exists) continue;
      runId ??= (await runFor(today)).id;
      try {
        await prisma.dailyCheckItem.create({
          data: { runId, name: def.name, category: def.code, definitionCode: def.code, periodKey: period.key, autoCheckKey: def.code },
        });
        created++;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      }
    }
  }
  return { created };
}
