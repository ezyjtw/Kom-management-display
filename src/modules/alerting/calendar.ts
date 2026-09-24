/**
 * Business-hours calendar for routing (spec §11.3) and SLA clocks.
 *
 * "24x7" is always business time. "business_uk" is Monday to Friday within
 * the configured hours (default 08:00-18:00, TODO(CONFIRM-BUSINESS-HOURS)) in
 * Europe/London, excluding PublicHoliday rows for the Global and EMEA regions.
 * Other "business_<region>" calendars fall back to business_uk until their
 * hours and time zones are confirmed.
 */

import { prisma } from "@/lib/prisma";
import { getSetting } from "@/modules/settings/settings";

const TZ = "Europe/London";
const UK_HOLIDAY_REGIONS = ["Global", "EMEA"];

export interface BusinessCalendar {
  is24x7: boolean;
  startMin: number; // minutes after local midnight
  endMin: number;
  holidays: Set<string>; // YYYY-MM-DD (London)
}

function hhmm(v: string): number {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
}

/** Local (London) wall-clock parts for an instant. */
export function londonParts(d: Date): { date: string; weekday: number; minute: number } {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { date: `${get("year")}-${get("month")}-${get("day")}`, weekday, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** UTC offset of London (minutes) at an instant. */
function londonOffsetMins(d: Date): number {
  const p = londonParts(d);
  const [y, mo, da] = p.date.split("-").map(Number);
  const asUtc = Date.UTC(y, mo - 1, da, Math.floor(p.minute / 60), p.minute % 60);
  return Math.round((asUtc - Math.floor(d.getTime() / 60_000) * 60_000) / 60_000);
}

/** The instant of a London wall-clock time on a London date. */
export function londonInstant(date: string, minuteOfDay: number): Date {
  const [y, mo, da] = date.split("-").map(Number);
  const guess = new Date(Date.UTC(y, mo - 1, da, Math.floor(minuteOfDay / 60), minuteOfDay % 60));
  return new Date(guess.getTime() - londonOffsetMins(guess) * 60_000);
}

function addDays(date: string, n: number): string {
  const [y, mo, da] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, da + n)).toISOString().slice(0, 10);
}

export async function loadCalendar(calendar: string, from: Date, to: Date): Promise<BusinessCalendar> {
  if (calendar === "24x7") return { is24x7: true, startMin: 0, endMin: 1440, holidays: new Set() };
  const hours = await getSetting("alerting.businessHours");
  const rows = await prisma.publicHoliday.findMany({
    where: { region: { in: UK_HOLIDAY_REGIONS }, date: { gte: new Date(from.getTime() - 2 * 86_400_000), lte: new Date(to.getTime() + 2 * 86_400_000) } },
    select: { date: true },
  });
  return {
    is24x7: false,
    startMin: hhmm(hours.start),
    endMin: hhmm(hours.end),
    holidays: new Set(rows.map((r) => r.date.toISOString().slice(0, 10))),
  };
}

function isBusinessDay(cal: BusinessCalendar, date: string, weekday: number): boolean {
  return weekday >= 1 && weekday <= 5 && !cal.holidays.has(date);
}

export function isBusinessTimeWith(cal: BusinessCalendar, at: Date): boolean {
  if (cal.is24x7) return true;
  const p = londonParts(at);
  return isBusinessDay(cal, p.date, p.weekday) && p.minute >= cal.startMin && p.minute < cal.endMin;
}

export async function isBusinessTime(calendar: string, at: Date): Promise<boolean> {
  return isBusinessTimeWith(await loadCalendar(calendar, at, at), at);
}

/** Business minutes elapsed between two instants. */
export function businessMinutesWith(cal: BusinessCalendar, from: Date, to: Date): number {
  if (to <= from) return 0;
  if (cal.is24x7) return (to.getTime() - from.getTime()) / 60_000;
  let total = 0;
  let date = londonParts(from).date;
  const lastDate = londonParts(to).date;
  for (let guard = 0; guard < 400 && date <= lastDate; guard++, date = addDays(date, 1)) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (!isBusinessDay(cal, date, weekday)) continue;
    const open = londonInstant(date, cal.startMin).getTime();
    const close = londonInstant(date, cal.endMin).getTime();
    const s = Math.max(open, from.getTime());
    const e = Math.min(close, to.getTime());
    if (e > s) total += (e - s) / 60_000;
  }
  return total;
}

/** End of the next business day (close of business), e.g. for SLA resolveRule "next_business_day_eod". */
export function nextBusinessDayEod(cal: BusinessCalendar, from: Date): Date {
  let date = addDays(londonParts(from).date, 1);
  for (let guard = 0; guard < 30; guard++, date = addDays(date, 1)) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (cal.is24x7 || isBusinessDay(cal, date, weekday)) return londonInstant(date, cal.is24x7 ? 1439 : cal.endMin);
  }
  return new Date(from.getTime() + 86_400_000);
}

/** The instant `mins` business minutes after `from` (for SLA due times). */
export function addBusinessMinutes(cal: BusinessCalendar, from: Date, mins: number): Date {
  if (mins <= 0) return from;
  if (cal.is24x7) return new Date(from.getTime() + mins * 60_000);
  let remaining = mins * 60_000;
  let date = londonParts(from).date;
  for (let guard = 0; guard < 400; guard++, date = addDays(date, 1)) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (!isBusinessDay(cal, date, weekday)) continue;
    const open = londonInstant(date, cal.startMin).getTime();
    const close = londonInstant(date, cal.endMin).getTime();
    const s = Math.max(open, from.getTime());
    if (close <= s) continue;
    if (s + remaining <= close) return new Date(s + remaining);
    remaining -= close - s;
  }
  return new Date(from.getTime() + mins * 60_000);
}
