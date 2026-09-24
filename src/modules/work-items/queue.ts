/**
 * The unified work queue (spec §14.1): every WorkItem, filtered by team, kind,
 * client, priority, SLA state, ticket project and owner, ordered by SLA time
 * remaining. Default: my team, open.
 */

import { z } from "zod";
import type { Prisma, SlaPolicy, WorkItem } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addBusinessMinutes, isBusinessTimeWith, loadCalendar, type BusinessCalendar } from "@/modules/alerting/calendar";
import { clockProgress, type SlaClock } from "@/modules/alerting/evaluators/sla";
import { clientWhere, type ClientScope } from "@/modules/auth/client-scope";

export const OPEN_STATES = ["open", "owned", "waiting_client", "waiting_vendor", "waiting_internal"] as const;
export const WORK_TEAMS = ["Team 1", "Team 2", "Team 3"] as const;

const KINDS = [
  "client_request", "client_incident", "client_risk", "alert", "daily_check_exception", "mtd_break", "oes_settlement", "fab_instruction",
  "kps_case", "vendor_ticket", "travel_rule_case", "screening_case", "scam_dust_case", "coin_review", "staking_exception", "nft_review",
  "report_task", "incident", "rca", "internal_task",
] as const;

export const queueFilterSchema = z.object({
  team: z.enum([...WORK_TEAMS, "all", "mine"]).default("mine"),
  kind: z.enum(KINDS).optional(),
  clientId: z.string().min(1).max(100).optional(),
  priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
  sla: z.enum(["ok", "warn", "breach", "none"]).optional(),
  project: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/).optional(),
  owner: z.enum(["me", "unassigned", "team", "any"]).default("any"),
  status: z.enum(["open", "resolved", "closed", "all"]).default("open"),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type QueueFilter = z.infer<typeof queueFilterSchema>;

export type SlaState = "ok" | "warn" | "breach" | "none";

export interface SlaStatus {
  state: SlaState;
  /** The running clock with the least time left. */
  clock: SlaClock | null;
  targetMins: number | null;
  elapsedMins: number | null;
  /** When that clock breaches (in the past once breached). */
  dueAt: string | null;
  /** Business-hours calendar outside business hours: the clock is paused. */
  paused: boolean;
}

const CLOCKS: SlaClock[] = ["ownership", "first_response", "resolution"];

export function slaStatus(item: WorkItem, policy: SlaPolicy | null, cal: BusinessCalendar | null, now: Date): SlaStatus {
  const none: SlaStatus = { state: "none", clock: null, targetMins: null, elapsedMins: null, dueAt: null, paused: false };
  if (!policy || !cal || !(OPEN_STATES as readonly string[]).includes(item.state)) return none;
  let best: { clock: SlaClock; pct: number; elapsedMins: number; targetMins: number; left: number } | null = null;
  let worst = 0;
  for (const clock of CLOCKS) {
    const p = clockProgress(item, policy, clock, cal, now);
    if (!p) continue;
    worst = Math.max(worst, p.pct);
    const left = p.targetMins - p.elapsedMins;
    if (!best || left < best.left) best = { clock, ...p, left };
  }
  if (!best) return none;
  const dueAt = best.left >= 0 ? addBusinessMinutes(cal, now, best.left) : new Date(now.getTime() + best.left * 60_000);
  return {
    state: worst >= 100 ? "breach" : worst >= policy.warnAtPct ? "warn" : "ok",
    clock: best.clock,
    targetMins: best.targetMins,
    elapsedMins: Math.round(best.elapsedMins),
    dueAt: dueAt.toISOString(),
    paused: !isBusinessTimeWith(cal, now),
  };
}

/** The user's work team: TeamConfig membership, then lead or deputy; null when not in a team. */
export async function myTeam(employeeId: string | null): Promise<string | null> {
  if (!employeeId) return null;
  const configs = await prisma.teamConfig.findMany({ orderBy: { team: "asc" } });
  const member = configs.find((c) => Array.isArray(c.memberEmployeeIds) && (c.memberEmployeeIds as unknown[]).includes(employeeId));
  if (member) return member.team;
  return configs.find((c) => c.leadEmployeeId === employeeId || c.deputyEmployeeId === employeeId)?.team ?? null;
}

async function teamMembers(team: string): Promise<string[]> {
  const cfg = await prisma.teamConfig.findUnique({ where: { team } });
  if (!cfg) return [];
  const members = Array.isArray(cfg.memberEmployeeIds) ? (cfg.memberEmployeeIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
  return [...new Set([...members, cfg.leadEmployeeId, cfg.deputyEmployeeId].filter((x): x is string => !!x))];
}

export interface QueueRow {
  id: string;
  title: string;
  kind: string;
  team: string;
  priority: string;
  state: string;
  client: { id: string; name: string } | null;
  ticketKey: string | null;
  ticketUrl: string | null;
  clientTicketKey: string | null;
  owner: { id: string; name: string } | null;
  lastActivityAt: string;
  sla: SlaStatus;
}

/** Timed items by due time (breached ones are already past due), then untimed items by priority and age. */
export function compareRows(a: QueueRow, b: QueueRow): number {
  if (a.sla.dueAt && b.sla.dueAt) return a.sla.dueAt.localeCompare(b.sla.dueAt);
  if (a.sla.dueAt || b.sla.dueAt) return a.sla.dueAt ? -1 : 1;
  return a.priority.localeCompare(b.priority) || a.lastActivityAt.localeCompare(b.lastActivityAt);
}

export async function listQueue(filter: QueueFilter, actor: { employeeId: string | null; scope?: ClientScope }, now = new Date()): Promise<{ team: string | null; rows: QueueRow[] }> {
  // Client isolation (spec §17.5): never list items of clients outside the user's scope.
  const where: Prisma.WorkItemWhereInput = { AND: [clientWhere(actor.scope ?? { all: true }) as Prisma.WorkItemWhereInput] };
  let team: string | null = null;
  if (filter.team === "mine") team = await myTeam(actor.employeeId);
  else if (filter.team !== "all") team = filter.team;
  if (team) where.team = { in: [team, "All"] };
  if (filter.status === "open") where.state = { in: [...OPEN_STATES] };
  else if (filter.status !== "all") where.state = filter.status;
  if (filter.kind) where.kind = filter.kind;
  if (filter.clientId) where.clientId = filter.clientId;
  if (filter.priority) where.priority = filter.priority;
  if (filter.project) where.ticketKey = { startsWith: `${filter.project}-` };
  if (filter.q) where.title = { contains: filter.q, mode: "insensitive" };
  if (filter.owner === "me") where.ownerEmployeeId = actor.employeeId ?? "__none__";
  else if (filter.owner === "unassigned") where.ownerEmployeeId = null;
  else if (filter.owner === "team") where.ownerEmployeeId = { in: team ? await teamMembers(team) : [] };

  const items = await prisma.workItem.findMany({
    where,
    include: { slaPolicy: true, client: { select: { id: true, displayName: true } }, owner: { select: { id: true, name: true } } },
    orderBy: { clockStartedAt: "asc" },
    take: 2000,
  });

  const calendars = new Map<string, BusinessCalendar>();
  const from = items.length ? new Date(Math.min(...items.map((i) => i.clockStartedAt.getTime()))) : now;
  for (const cal of new Set(items.map((i) => i.slaPolicy?.calendar).filter((c): c is string => !!c))) {
    calendars.set(cal, await loadCalendar(cal, from, new Date(now.getTime() + 14 * 86_400_000)));
  }

  const rows = items
    .map((i): QueueRow => ({
      id: i.id,
      title: i.title,
      kind: i.kind,
      team: i.team,
      priority: i.priority,
      state: i.state,
      client: i.client ? { id: i.client.id, name: i.client.displayName } : null,
      ticketKey: i.ticketKey,
      ticketUrl: i.ticketUrl,
      clientTicketKey: i.clientTicketKey,
      owner: i.owner ? { id: i.owner.id, name: i.owner.name } : null,
      lastActivityAt: i.updatedAt.toISOString(),
      sla: slaStatus(i, i.slaPolicy?.isActive ? i.slaPolicy : null, i.slaPolicy ? calendars.get(i.slaPolicy.calendar) ?? null : null, now),
    }))
    .filter((r) => !filter.sla || r.sla.state === filter.sla)
    .sort(compareRows)
    .slice(0, filter.limit);
  return { team, rows };
}
