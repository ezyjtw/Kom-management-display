/**
 * Clients view (spec §14.1): per client, open items, SLA status, recent
 * activity, logged effort (team level, never per person: H4) and channels.
 */

import { prisma } from "@/lib/prisma";
import { loadCalendar, type BusinessCalendar } from "@/modules/alerting/calendar";
import { OPEN_STATES, slaStatus } from "@/modules/work-items/queue";
import { clientTableWhere, type ClientScope } from "@/modules/auth/client-scope";

export async function clientsOverview(now = new Date(), scope: ClientScope = { all: true }) {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const [clients, items, logs, channels, slackChannels] = await Promise.all([
    prisma.client.findMany({ where: { isActive: true, ...clientTableWhere(scope) }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true } }),
    prisma.workItem.findMany({ where: { clientId: { not: null }, state: { in: [...OPEN_STATES] } }, include: { slaPolicy: true } }),
    prisma.timeLog.findMany({ where: { clientId: { not: null }, loggedAt: { gte: since } }, select: { clientId: true, bucketMins: true } }),
    prisma.clientChannel.findMany({ select: { clientId: true, kind: true, ref: true } }),
    prisma.slackChannel.findMany({ where: { clientId: { not: null } }, select: { clientId: true, channelId: true, channelName: true } }),
  ]);
  const recent = await prisma.workItem.findMany({ where: { clientId: { in: clients.map((c) => c.id) }, updatedAt: { gte: since } }, select: { clientId: true, updatedAt: true } });
  const lastActivity = new Map<string, Date>();
  for (const r of recent) if (r.clientId && (!lastActivity.get(r.clientId) || r.updatedAt > lastActivity.get(r.clientId)!)) lastActivity.set(r.clientId, r.updatedAt);

  const calendars = new Map<string, BusinessCalendar>();
  const from = items.length ? new Date(Math.min(...items.map((i) => i.clockStartedAt.getTime()))) : now;
  for (const cal of new Set(items.map((i) => i.slaPolicy?.calendar).filter((c): c is string => !!c))) {
    calendars.set(cal, await loadCalendar(cal, from, new Date(now.getTime() + 14 * 86_400_000)));
  }

  return clients.map((c) => {
    const mine = items.filter((i) => i.clientId === c.id);
    const states = mine.map((i) => slaStatus(i, i.slaPolicy?.isActive ? i.slaPolicy : null, i.slaPolicy ? calendars.get(i.slaPolicy.calendar) ?? null : null, now).state);
    const effortMins = logs.filter((l) => l.clientId === c.id).reduce((s, l) => s + l.bucketMins, 0);
    return {
      clientId: c.id,
      client: c.displayName,
      openItems: mine.length,
      sla: { breach: states.filter((s) => s === "breach").length, warn: states.filter((s) => s === "warn").length },
      lastActivityAt: lastActivity.get(c.id)?.toISOString() ?? null,
      loggedEffortHours30d: Math.round((effortMins / 60) * 100) / 100,
      channels: [
        ...slackChannels.filter((s) => s.clientId === c.id).map((s) => ({ kind: "slack", ref: `#${s.channelName}` })),
        ...channels.filter((ch) => ch.clientId === c.id && ch.kind !== "slack").map((ch) => ({ kind: ch.kind, ref: ch.ref })),
      ],
    };
  });
}
