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
  /** pending | partially_posted | posted | failed (see LeadHandover.postStatus). */
  postStatus: string;
  postedAt: string | null;
  /** Tickets that accepted the comment. */
  postedTo: number;
  /** Tickets whose comment failed and still need a retry. */
  failedTickets: string[];
  missing: boolean;
  /** Reminder evidence when the note was missing: recipients reached / total. */
  reminder: { reached: number; recipients: number; notifiedAt: string | null } | null;
}

export interface PostResult {
  workItemId: string;
  ticketKey: string;
  ok: boolean;
  error?: string;
  at: string;
}

export interface ReminderResult {
  userId: string;
  inApp: boolean;
  slack: boolean | null; // null: no Slack user found
  email: boolean;
  at: string;
}

export const postResultsOf = (row: { postResults: unknown } | null | undefined): PostResult[] =>
  Array.isArray(row?.postResults) ? (row!.postResults as PostResult[]) : [];
const reminderResultsOf = (row: { reminderResults: unknown } | null | undefined): ReminderResult[] =>
  Array.isArray(row?.reminderResults) ? (row!.reminderResults as ReminderResult[]) : [];
const reached = (r: ReminderResult) => r.inApp || r.slack === true || r.email;

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
    postStatus: row?.postStatus ?? "pending",
    postedAt: row?.postedAt?.toISOString() ?? null,
    postedTo: postResultsOf(row).filter((r) => r.ok).length,
    failedTickets: postResultsOf(row).filter((r) => !r.ok).map((r) => r.ticketKey),
    missing: absent && !row?.note && now >= deadline,
    reminder: reminderResultsOf(row).length
      ? { reached: reminderResultsOf(row).filter(reached).length, recipients: reminderResultsOf(row).length, notifiedAt: row?.missingNotifiedAt?.toISOString() ?? null }
      : null,
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

/**
 * Who may cover a team's lead on a date: the deputy and the configured team
 * members (TeamConfig), active, not the lead, and not on approved leave that
 * day. TODO(CONFIRM-COVER-POOL): a trained-cover / competency list may replace this.
 */
export async function coverPool(team: string, date: string): Promise<Array<{ id: string; name: string }>> {
  const cfg = await prisma.teamConfig.findUnique({ where: { team } });
  if (!cfg) return [];
  const members = Array.isArray(cfg.memberEmployeeIds) ? (cfg.memberEmployeeIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const ids = [...new Set([cfg.deputyEmployeeId, ...members].filter((x): x is string => !!x && x !== cfg.leadEmployeeId))];
  const people = await prisma.employee.findMany({ where: { id: { in: ids }, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const out: Array<{ id: string; name: string }> = [];
  for (const p of people) if (!(await onPto(p.id, date))) out.push({ id: p.id, name: p.name });
  return out;
}

export const absenceSchema = z.object({ date: dateSchema, team: z.enum(TEAMS), absent: z.boolean() });

/** Manual absence toggle by the lead, their deputy or an admin. PTO absence is changed in the schedule, not here. */
export async function setAbsence(input: z.infer<typeof absenceSchema>, actor: { employeeId: string | null; role: string }): Promise<LeadHandover> {
  const cfg = await teamConfig(input.team);
  if (!canAct(actor, cfg)) throw new HandoverError("Only the team's lead, deputy or an admin can change this.", 403);
  if (!input.absent && (await onPto(cfg.leadEmployeeId!, input.date))) throw new HandoverError("The lead is on approved leave that day; change it in the schedule.", 409);
  const existing = await prisma.leadHandover.findUnique({ where: { date_team: { date: input.date, team: input.team } } });
  if (!input.absent && existing?.note) throw new HandoverError("A handover is already recorded for that day.", 409);
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
  const pool = await coverPool(input.team, input.date);
  if (!pool.some((p) => p.id === input.coveringEmployeeId)) {
    throw new HandoverError(pool.length
      ? "The covering member must be the team's deputy or a team member who is active and not on leave that day."
      : `${input.team} has no available cover: add the deputy and team members in Admin → Reference data → Team config.`);
  }
  const existing = await prisma.leadHandover.findUnique({ where: { date_team: { date: input.date, team: input.team } } });
  if (existing && existing.postStatus !== "pending") throw new HandoverError("The handover for that day has already been posted (or partly posted) to the tickets; retry failed tickets instead.", 409);
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

/**
 * Post the note as an internal comment on each of the lead's open tickets.
 * Every ticket's outcome is recorded; tickets that already accepted the
 * comment are not posted to again. postStatus becomes "posted" (and postedAt
 * is set) only when every ticket accepted it; otherwise "partially_posted" or
 * "failed", and the job and the retry action try the failed tickets again.
 */
export async function postHandover(row: LeadHandover, now = new Date()): Promise<LeadHandover> {
  if (!row.note || row.postStatus === "posted") return row;
  const [lead, covering] = await Promise.all([
    prisma.employee.findUnique({ where: { id: row.leadEmployeeId }, select: { name: true } }),
    row.coveringEmployeeId ? prisma.employee.findUnique({ where: { id: row.coveringEmployeeId }, select: { name: true } }) : null,
  ]);
  const previous = postResultsOf(row);
  const done = new Set(previous.filter((r) => r.ok).map((r) => r.workItemId));
  const items = await prisma.workItem.findMany({
    where: { ownerEmployeeId: row.leadEmployeeId, state: { in: [...OPEN] }, ticketKey: { not: null } },
    select: { id: true, ticketKey: true },
  });
  const text = `Handover ${row.date}: ${lead?.name ?? "the lead"} is out. Covering: ${covering?.name ?? "see note"}.\n\n${row.note}`;
  const results = new Map<string, PostResult>(previous.map((r) => [r.workItemId, r]));
  for (const item of items) {
    if (done.has(item.id)) continue;
    try {
      await commentInternal(item.id, text);
      results.set(item.id, { workItemId: item.id, ticketKey: item.ticketKey!, ok: true, at: now.toISOString() });
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      results.set(item.id, { workItemId: item.id, ticketKey: item.ticketKey!, ok: false, error: message, at: now.toISOString() });
      logger.warn("Handover comment failed on one ticket", { error: message });
    }
  }
  const all = [...results.values()];
  const ok = all.filter((r) => r.ok).length;
  const status = ok === all.length ? "posted" : ok === 0 ? "failed" : "partially_posted";
  return prisma.leadHandover.update({
    where: { id: row.id },
    data: {
      postStatus: status,
      postAttempts: { increment: 1 },
      lastPostAttemptAt: now,
      postedAt: status === "posted" ? now : null,
      postResults: all as unknown as Prisma.InputJsonValue,
    },
  });
}

export const retrySchema = z.object({ date: dateSchema, team: z.enum(TEAMS) });

/** Retry the tickets whose handover comment failed (lead, deputy or admin). */
export async function retryHandover(input: z.infer<typeof retrySchema>, actor: { employeeId: string | null; role: string }, now = new Date()): Promise<LeadHandover> {
  const cfg = await teamConfig(input.team);
  if (!canAct(actor, cfg)) throw new HandoverError("Only the team's lead, deputy or an admin can retry the handover.", 403);
  const row = await prisma.leadHandover.findUnique({ where: { date_team: { date: input.date, team: input.team } } });
  if (!row?.note) throw new HandoverError("There is no saved handover for that day.", 404);
  if (row.postStatus === "posted") throw new HandoverError("The handover is already posted to every ticket.", 409);
  if (input.date !== londonParts(now).date) throw new HandoverError("Only today's handover can be posted.", 409);
  return postHandover(row, now);
}

/**
 * In-app, Slack DM and email to the lead and every admin (Head of Transaction
 * Operations). Each channel is attempted independently and its outcome
 * recorded; nothing is counted as sent without the channel accepting it.
 */
export async function notifyLeadAndHead(leadId: string, title: string, body: string, now = new Date()): Promise<ReminderResult[]> {
  const users = await prisma.user.findMany({ where: { OR: [{ employeeId: leadId }, { role: "admin" }] }, select: { id: true, email: true } });
  const link = `${(env("NEXTAUTH_URL") ?? "").replace(/\/+$/, "")}/morning`;
  const results: ReminderResult[] = [];
  for (const u of users) {
    const r: ReminderResult = { userId: u.id, inApp: false, slack: null, email: false, at: now.toISOString() };
    try {
      await prisma.inAppNotification.create({ data: { userId: u.id, title, body, link: "/morning" } });
      r.inApp = true;
    } catch (error) {
      logger.warn("Handover reminder: in-app notification failed", { error: error instanceof Error ? error.message : String(error) });
    }
    try {
      const slack = getSlackClient();
      const res = slack ? await slack.users.lookupByEmail({ email: u.email }) : null;
      if (res?.user?.id) {
        const sent = await slack!.chat.postMessage({ channel: res.user.id, text: `${title}\n${body}\n${link}` });
        r.slack = sent?.ok !== false;
      }
    } catch (error) {
      r.slack = false;
      logger.warn("Handover reminder: Slack DM failed", { error: error instanceof Error ? error.message : String(error) });
    }
    try {
      r.email = await sendEmailNotification(u.email, title, `${body}\n\n${link}`);
    } catch (error) {
      logger.warn("Handover reminder: email failed", { error: error instanceof Error ? error.message : String(error) });
    }
    results.push(r);
  }
  return results;
}

/**
 * From 09:00 UK on business days (every 15 minutes until noon): post saved
 * handovers for absent leads and retry failed tickets; where the note is
 * missing, remind the lead and the Head of Transaction Operations. The
 * reminder counts as done only when every recipient was reached on at least
 * one channel; otherwise the next run tries again.
 */
export async function runMorningHandover(now = new Date()): Promise<{ posted: number; incomplete: number; missing: number; skipped?: string }> {
  const today = londonParts(now).date;
  const cal = await loadCalendar("business_uk", now, now);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6 || cal.holidays.has(today)) return { posted: 0, incomplete: 0, missing: 0, skipped: "not a business day" };
  if (now < londonInstant(today, HANDOVER_DEADLINE_MIN)) return { posted: 0, incomplete: 0, missing: 0, skipped: "before 09:00" };

  let posted = 0;
  let incomplete = 0;
  let missing = 0;
  for (const team of TEAMS) {
    const cfg = await prisma.teamConfig.findUnique({ where: { team } });
    if (!cfg?.leadEmployeeId) continue;
    const pto = await onPto(cfg.leadEmployeeId, today);
    let row = await prisma.leadHandover.findUnique({ where: { date_team: { date: today, team } } });
    if (!pto && !row?.absent) continue;
    row ??= await prisma.leadHandover.create({ data: { date: today, team, leadEmployeeId: cfg.leadEmployeeId, absent: true, absenceSource: "pto" } });
    if (row.note) {
      if (row.postStatus !== "posted") {
        const after = await postHandover(row, now);
        if (after.postStatus === "posted") posted++;
        else incomplete++;
      }
      continue;
    }
    missing++;
    if (row.missingNotifiedAt) continue;
    const lead = await prisma.employee.findUnique({ where: { id: cfg.leadEmployeeId }, select: { name: true } });
    const results = await notifyLeadAndHead(
      cfg.leadEmployeeId,
      `Handover missing for ${team}`,
      `${lead?.name ?? "The lead"} is absent today and no handover note (covering member and note) was saved before 09:00. Add it on the Morning board.`,
      now,
    );
    const everyoneReached = results.length > 0 && results.every(reached);
    await prisma.leadHandover.update({
      where: { id: row.id },
      data: { reminderResults: results as unknown as Prisma.InputJsonValue, missingNotifiedAt: everyoneReached ? now : null },
    });
  }
  return { posted, incomplete, missing };
}
