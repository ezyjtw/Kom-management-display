/**
 * Morning board (spec §14.3, 09:05 UK). Built only from tickets and
 * WorkItems: anything not on a ticket does not appear ("no verbal-only
 * updates"). Per team: the previous business day's checks not completed, open
 * exceptions with age, blockers (waiting states with reason), SLA breaches in
 * the last 24 hours, active alerts, and FAB and OES status.
 */

import { prisma } from "@/lib/prisma";
import { loadCalendar, londonParts, type BusinessCalendar } from "@/modules/alerting/calendar";
import { coverPool, handoverStatus, type HandoverStatus } from "@/modules/morning/handover";

export const BOARD_TEAMS = ["Team 1", "Team 2", "Team 3", "All"] as const;
const OPEN = ["open", "owned", "waiting_client", "waiting_vendor", "waiting_internal"] as const;
const WAITING = ["waiting_client", "waiting_vendor", "waiting_internal"];

export const NO_VERBAL_BANNER = "No verbal-only updates: items that are not on a ticket do not appear on this board.";

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The London business day before `date` (skips weekends and UK holidays). */
export function previousBusinessDate(cal: BusinessCalendar, date: string): string {
  let d = addDays(date, -1);
  for (let i = 0; i < 14; i++, d = addDays(d, -1)) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd >= 1 && wd <= 5 && !cal.holidays.has(d)) return d;
  }
  return addDays(date, -1);
}

interface ItemRef {
  id: string;
  title: string;
  kind: string;
  ticketKey: string;
  ticketUrl: string | null;
}

export interface TeamBoard {
  team: string;
  lead: { id: string; name: string } | null;
  deputyId: string | null;
  handover: HandoverStatus | null;
  /** Who may cover the lead today (deputy and team members, active, not on leave). */
  coverPool: Array<{ id: string; name: string }>;
  checksNotCompleted: Array<{ code: string; name: string; periodKey: string; status: string }>;
  openExceptions: Array<ItemRef & { ageMins: number }>;
  blockers: Array<ItemRef & { state: string; reason: string | null; sinceMins: number }>;
  slaBreaches24h: Array<ItemRef & { breach: string; at: string }>;
  activeAlerts: Array<{ id: string; ruleCode: string; severity: string; message: string; workItemId: string; ticketKey: string }>;
  fab: { open: number; items: ItemRef[] };
  oes: { open: number; items: ItemRef[] };
}

const mins = (from: Date, now: Date) => Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));

export async function buildMorningBoard(now = new Date()) {
  const today = londonParts(now).date;
  const cal = await loadCalendar("business_uk", new Date(now.getTime() - 14 * 86_400_000), now);
  const previous = previousBusinessDate(cal, today);

  const [defs, checkItems, openItems, breachEvents, alerts, configs, report] = await Promise.all([
    prisma.dailyCheckDefinition.findMany({ where: { isActive: true }, select: { code: true, name: true, team: true } }),
    prisma.dailyCheckItem.findMany({ where: { periodKey: previous, definitionCode: { not: null }, status: "pending" }, select: { definitionCode: true, periodKey: true, status: true } }),
    prisma.workItem.findMany({
      where: { state: { in: [...OPEN] }, ticketKey: { not: null } },
      select: { id: true, title: true, kind: true, team: true, state: true, ticketKey: true, ticketUrl: true, clockStartedAt: true, updatedAt: true, metadata: true, ownerEmployeeId: true },
    }),
    prisma.slaEvent.findMany({ where: { at: { gte: new Date(now.getTime() - 86_400_000) } }, select: { workItemId: true, kind: true, at: true } }),
    prisma.alert.findMany({ where: { status: "active", workItemId: { not: null } }, select: { id: true, ruleCode: true, severity: true, message: true, workItemId: true } }),
    prisma.teamConfig.findMany(),
    prisma.sourceRecord.findFirst({ where: { source: "kommand", kind: "unticketed_report" }, orderBy: { occurredAt: "desc" }, select: { externalId: true, fields: true } }),
  ]);

  const defByCode = new Map(defs.map((d) => [d.code, d]));
  const byId = new Map(openItems.map((i) => [i.id, i]));
  const breachedIds = [...new Set(breachEvents.filter((e) => e.kind.endsWith("_breach")).map((e) => e.workItemId))];
  const breachedItems = await prisma.workItem.findMany({ where: { id: { in: breachedIds }, ticketKey: { not: null } }, select: { id: true, title: true, kind: true, team: true, ticketKey: true, ticketUrl: true } });
  const leadIds = configs.map((c) => c.leadEmployeeId).filter((x): x is string => !!x);
  const leads = new Map((await prisma.employee.findMany({ where: { id: { in: leadIds } }, select: { id: true, name: true } })).map((e) => [e.id, { id: e.id, name: e.name }]));
  const ref = (i: { id: string; title: string; kind: string; ticketKey: string | null; ticketUrl: string | null }): ItemRef => ({ id: i.id, title: i.title, kind: i.kind, ticketKey: i.ticketKey!, ticketUrl: i.ticketUrl });

  const teams: TeamBoard[] = [];
  for (const team of BOARD_TEAMS) {
    const mine = openItems.filter((i) => i.team === team);
    const cfg = configs.find((c) => c.team === team);
    const lead = cfg?.leadEmployeeId ? leads.get(cfg.leadEmployeeId) ?? null : null;
    const oes = mine.filter((i) => i.kind === "oes_settlement");
    const fab = mine.filter((i) => i.kind === "fab_instruction");
    teams.push({
      team,
      lead,
      deputyId: cfg?.deputyEmployeeId ?? null,
      handover: team !== "All" && lead ? await handoverStatus(today, team, lead.id, now) : null,
      coverPool: team !== "All" && lead ? await coverPool(team, today) : [],
      checksNotCompleted: checkItems
        .filter((c) => defByCode.get(c.definitionCode!)?.team === team)
        .map((c) => ({ code: c.definitionCode!, name: defByCode.get(c.definitionCode!)!.name, periodKey: c.periodKey!, status: c.status })),
      openExceptions: mine
        .filter((i) => i.kind === "daily_check_exception" || i.kind === "mtd_break")
        .map((i) => ({ ...ref(i), ageMins: mins(i.clockStartedAt, now) }))
        .sort((a, b) => b.ageMins - a.ageMins),
      blockers: mine
        .filter((i) => WAITING.includes(i.state))
        .map((i) => {
          const meta = (i.metadata ?? {}) as Record<string, unknown>;
          const since = typeof meta.waitingSince === "string" ? new Date(meta.waitingSince) : i.updatedAt;
          return { ...ref(i), state: i.state, reason: typeof meta.waitingReason === "string" ? meta.waitingReason : null, sinceMins: mins(since, now) };
        })
        .sort((a, b) => b.sinceMins - a.sinceMins),
      slaBreaches24h: breachedItems
        .filter((i) => i.team === team)
        .flatMap((i) => breachEvents.filter((e) => e.workItemId === i.id && e.kind.endsWith("_breach")).map((e) => ({ ...ref(i), breach: e.kind.replace("_breach", "").replace("_", " "), at: e.at.toISOString() }))),
      activeAlerts: alerts
        .filter((a) => byId.get(a.workItemId!)?.team === team)
        .map((a) => ({ id: a.id, ruleCode: a.ruleCode, severity: a.severity, message: a.message, workItemId: a.workItemId!, ticketKey: byId.get(a.workItemId!)!.ticketKey! })),
      fab: { open: fab.length, items: fab.slice(0, 10).map(ref) },
      oes: { open: oes.length, items: oes.slice(0, 10).map(ref) },
    });
  }

  const f = (report?.fields ?? {}) as Record<string, unknown>;
  return {
    date: today,
    previousBusinessDate: previous,
    asOf: now.toISOString(),
    banner: NO_VERBAL_BANNER,
    unticketed: report ? { date: report.externalId, total: Number(f.total ?? 0) } : null,
    teams,
  };
}
