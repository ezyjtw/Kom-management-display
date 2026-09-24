/**
 * Lead handover (spec §14.3). A lead is absent when an approved PTO record
 * covers the day (not WFH) or when absence is toggled manually. An absent lead
 * selects a covering member and writes a handover note before 09:00 UK. The
 * note posts as an internal comment on each of the lead's open tickets. If it
 * is missing at 09:00, the lead and the Head of Transaction Operations (role
 * admin) are notified. Informational only: links, no actions.
 */

import { z } from "zod";
import type { LeadHandover, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import { getSlackClient } from "@/lib/integrations/slack";
import { sendEmailNotification } from "@/lib/integrations/email";
import { londonInstant, londonParts, loadCalendar } from "@/modules/alerting/calendar";
import { commentInternal } from "@/modules/work-items/ticket-writeback";

export const HANDOVER_DEADLINE_MIN = 9 * 60; // 09:00 London
const OPEN = ["open", "owned", "waiting_client", "waiting_vendor", "waiting_internal"] as const;
const TEAMS = ["Team 1", "Team 2", "Team 3"] as const;

export class HandoverError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
    this.name = "HandoverError";
  }
}

export interface HandoverStatus {
  absent: boolean;
  source: "pto" | "manual" | null;
  covering: { id: string; name: string } | null;
  note: string | null;
  submittedAt: string | null;
  late: boolean;
  postedAt: string | null;
  postedTo: number;
  missing: boolean;
}

const dayBounds = (date: string) => ({ start: new Date(`${date}T00:00:00.000Z`), end: new Date(`${date}T23:59:59.999Z`) });

/** Approved, non-WFH PTO covering the London date. */
export async function onPto(employeeId: string, date: string): Promise<boolean> {
  const { start, end } = dayBounds(date);
  const n = await prisma.ptoRecord.count({ where: { employeeId, status: "approved", type: { not: "wfh" }, startDate: { lte: end }, endDate: { gte: start } } });
  return n > 0;
}

export async function handoverStatus(date: string, team: string, leadId: string, now = new Date()): Promise<HandoverStatus> {
  const row = await prisma.leadHandover.findUnique({ where: { date_team: { date, team } } });
  const pto = await onPto(leadId, date);
  const absent = pto || (row?.absent ?? false);
  const deadline = londonInstant(date, HANDOVER_DEADLINE_MIN);
  const covering = row?.coveringEmployeeId ? await prisma.employee.findUnique({ where: { id: row.coveringEmployeeId }, select: { id: true, name: true } }) : null;
  return {
    absent,
    source: pto ? "pto" : row?.absent ? "manual" : null,
    covering,
    note: row?.note ?? null,
    submittedAt: row?.submittedAt?.toISOString() ?? null,
    late: !!row?.submittedAt && row.submittedAt > deadline,
    postedAt: row?.postedAt?.toISOString() ?? null,
    postedTo: Array.isArray(row?.postResults) ? (row!.postResults as unknown[]).length : 0,
    missing: absent && !row?.note && now >= deadline,
  };
}

async function teamConfig(team: string) {
  const cfg = await prisma.teamConfig.findUnique({ where: { team } });
  if (!cfg?.leadEmployeeId) throw new HandoverError(`${team} has no lead configured (Admin → Reference data → Team config).`, 409);
  return cfg;
}

function canAct(actor: { employeeId: string | null; role: string }, cfg: { leadEmployeeId: string | null; deputyEmployeeId: string | null }) {
  return actor.role === "admin" || (!!actor.employeeId && (actor.employeeId === cfg.leadEmployeeId || actor.employeeId === cfg.deputyEmployeeId));
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const absenceSchema = z.object({ date: dateSchema, team: z.enum(TEAMS), absent: z.boolean() });

/** Manual absence toggle by the lead, their deputy or an admin. PTO absence is changed in the schedule, not here. */
export async function setAbsence(input: z.infer<typeof absenceSchema>, actor: { employeeId: string | null; role: string }): Promise<LeadHandover> {
  const cfg = await teamConfig(input.team);
  if (!canAct(actor, cfg)) throw new HandoverError("Only the team's lead, deputy or an admin can change this.", 403);
  if (!input.absent && (await onPto(cfg.leadEmployeeId!, input.date))) throw new HandoverError("The lead is on approved leave that day; change it in the schedule.", 409);
  return prisma.leadHandover.upsert({
    where: { date_team: { date: input.date, team: input.team } },
    update: { absent: input.absent, absenceSource: "manual" },
    create: { date: input.date, team: input.team, leadEmployeeId: cfg.leadEmployeeId!, absent: input.absent, absenceSource: "manual" },
  });
}

export const handoverSchema = z.object({
  date: dateSchema,
  team: z.enum(TEAMS),
  coveringEmployeeId: z.string().min(1).max(100),
  note: z.string().trim().min(20).max(4000),
});

/**
 * Save the handover (the lead, their deputy or an admin). It posts to the
 * lead's open tickets straight away when it is for today, otherwise at 09:00
 * on the day (morning_handover job).
 */
export async function submitHandover(input: z.infer<typeof handoverSchema>, actor: { employeeId: string | null; role: string }, now = new Date()) {
  const cfg = await teamConfig(input.team);
  if (!canAct(actor, cfg)) throw new HandoverError("Only the team's lead, deputy or an admin can write the handover.", 403);
  const today = londonParts(now).date;
  if (input.date < today) throw new HandoverError("The handover date has passed.");
  if (input.coveringEmployeeId === cfg.leadEmployeeId) throw new HandoverError("Choose someone other than the absent lead to cover.");
  const covering = await prisma.employee.findUnique({ where: { id: input.coveringEmployeeId }, select: { active: true } });
  if (!covering?.active) throw new HandoverError("The covering member does not exist or is inactive.");
  const existing = await prisma.leadHandover.findUnique({ where: { date_team: { date: input.date, team: input.team } } });
  if (existing?.postedAt) throw new HandoverError("The handover for that day has already been posted to the tickets.", 409);
  const pto = await onPto(cfg.leadEmployeeId!, input.date);
  const row = await prisma.leadHandover.upsert({
    where: { date_team: { date: input.date, team: input.team } },
    update: { absent: true, coveringEmployeeId: input.coveringEmployeeId, note: input.note, submittedById: actor.employeeId, submittedAt: now, ...(pto ? { absenceSource: "pto" } : {}) },
    create: {
      date: input.date, team: input.team, leadEmployeeId: cfg.leadEmployeeId!, absent: true, absenceSource: pto ? "pto" : "manual",
      coveringEmployeeId: input.coveringEmployeeId, note: input.note, submittedById: actor.employeeId, submittedAt: now,
    },
  });
  return input.date === today ? postHandover(row, now) : row;
}

/** Post the note as an internal comment on each of the lead's open tickets. Failures are recorded per ticket. */
export async function postHandover(row: LeadHandover, now = new Date()): Promise<LeadHandover> {
  if (!row.note || row.postedAt) return row;
  const [lead, covering] = await Promise.all([
    prisma.employee.findUnique({ where: { id: row.leadEmployeeId }, select: { name: true } }),
    row.coveringEmployeeId ? prisma.employee.findUnique({ where: { id: row.coveringEmployeeId }, select: { name: true } }) : null,
  ]);
  const items = await prisma.workItem.findMany({
    where: { ownerEmployeeId: row.leadEmployeeId, state: { in: [...OPEN] }, ticketKey: { not: null } },
    select: { id: true, ticketKey: true },
  });
  const text = `Handover ${row.date}: ${lead?.name ?? "the lead"} is out. Covering: ${covering?.name ?? "see note"}.\n\n${row.note}`;
  const results: Array<{ ticketKey: string; ok: boolean }> = [];
  for (const item of items) {
    try {
      await commentInternal(item.id, text);
      results.push({ ticketKey: item.ticketKey!, ok: true });
    } catch (error) {
      results.push({ ticketKey: item.ticketKey!, ok: false });
      logger.warn("Handover comment failed on one ticket", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return prisma.leadHandover.update({ where: { id: row.id }, data: { postedAt: now, postResults: results as unknown as Prisma.InputJsonValue } });
}

/** In-app, Slack DM and email to the given employees and every admin (Head of Transaction Operations). */
async function notifyLeadAndHead(leadId: string, title: string, body: string): Promise<number> {
  const users = await prisma.user.findMany({ where: { OR: [{ employeeId: leadId }, { role: "admin" }] }, select: { id: true, email: true } });
  const link = `${(env("NEXTAUTH_URL") ?? "").replace(/\/+$/, "")}/morning`;
  let sent = 0;
  for (const u of users) {
    await prisma.inAppNotification.create({ data: { userId: u.id, title, body, link: "/morning" } });
    try {
      const slack = getSlackClient();
      const res = await slack?.users.lookupByEmail({ email: u.email });
      if (res?.user?.id) await slack!.chat.postMessage({ channel: res.user.id, text: `${title}\n${body}\n${link}` });
      await sendEmailNotification(u.email, title, `${body}\n\n${link}`);
    } catch (error) {
      logger.warn("Handover reminder failed for one recipient", { error: error instanceof Error ? error.message : String(error) });
    }
    sent++;
  }
  return sent;
}

/**
 * 09:00 UK on business days: post saved handovers for absent leads, and
 * notify the lead and the Head of Transaction Operations where the note is
 * missing (once per day).
 */
export async function runMorningHandover(now = new Date()): Promise<{ posted: number; missing: number; skipped?: string }> {
  const today = londonParts(now).date;
  const cal = await loadCalendar("business_uk", now, now);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6 || cal.holidays.has(today)) return { posted: 0, missing: 0, skipped: "not a business day" };

  let posted = 0;
  let missing = 0;
  for (const team of TEAMS) {
    const cfg = await prisma.teamConfig.findUnique({ where: { team } });
    if (!cfg?.leadEmployeeId) continue;
    const pto = await onPto(cfg.leadEmployeeId, today);
    let row = await prisma.leadHandover.findUnique({ where: { date_team: { date: today, team } } });
    if (!pto && !row?.absent) continue;
    row ??= await prisma.leadHandover.create({ data: { date: today, team, leadEmployeeId: cfg.leadEmployeeId, absent: true, absenceSource: "pto" } });
    if (row.note) {
      if (!row.postedAt) {
        await postHandover(row, now);
        posted++;
      }
      continue;
    }
    if (row.missingNotifiedAt) continue;
    const lead = await prisma.employee.findUnique({ where: { id: cfg.leadEmployeeId }, select: { name: true } });
    await notifyLeadAndHead(
      cfg.leadEmployeeId,
      `Handover missing for ${team}`,
      `${lead?.name ?? "The lead"} is absent today and no handover note (covering member and note) was saved before 09:00. Add it on the Morning board.`,
    );
    await prisma.leadHandover.update({ where: { id: row.id }, data: { missingNotifiedAt: now } });
    missing++;
  }
  return { posted, missing };
}
