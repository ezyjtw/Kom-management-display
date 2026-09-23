/**
 * Routing and escalation (spec §11.3). Informational only: messages carry
 * links, never action buttons (H1). No PagerDuty in Phase 1.
 *
 * - Business hours: alerts_out channel + in-app (the Alert row). High and
 *   critical also mention the owning team's lead.
 * - Out of hours: the on-call primary for the owning team (Slack DM + email).
 *   Critical alerts not acknowledged within `alerting.oohAckMins` go to the
 *   on-call secondary and the lead.
 * - Escalation ladder per rule: params.escalation = [{afterMins, notifyRole}].
 * - Quiet rule: the same alert never re-notifies within `alerting.quietMins`.
 * - Digest rules (medium config rules) notify once a day at 08:00.
 */

import type { Alert, AlertRule } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import { getSlackClient } from "@/lib/integrations/slack";
import { sendEmailNotification } from "@/lib/integrations/email";
import { postAlertToSlack } from "@/modules/integrations/slack/alerts-out";
import { getSetting } from "@/modules/settings/settings";
import { isBusinessTime, londonParts } from "@/modules/alerting/calendar";
import { effectiveParams, RULE_CATALOGUE, TEAMS } from "@/modules/alerting/catalogue";
import type { EscalationStep } from "@/modules/alerting/types";

type AlertWithTicket = Alert & { workItem: { id: string; ticketKey: string | null; ticketUrl: string | null } | null };

export interface Recipient {
  email: string;
}

const TEAM_ENUM: Record<string, string> = {
  [TEAMS.txOps]: "TransactionOperations",
  [TEAMS.adminOps]: "AdminOperations",
  [TEAMS.dataOps]: "DataOperations",
  [TEAMS.staking]: "StakingOps",
  [TEAMS.settlements]: "Settlements",
};

export async function teamLeads(team: string): Promise<Recipient[]> {
  const teamEnum = TEAM_ENUM[team];
  if (!teamEnum) return [];
  const rows = await prisma.employee.findMany({
    where: { active: true, role: "Lead", team: teamEnum as never },
    select: { email: true },
  });
  return rows;
}

export async function admins(): Promise<Recipient[]> {
  return prisma.user.findMany({ where: { role: "admin" }, select: { email: true } });
}

/** On-call for a team on the London calendar day of `at`. shiftType "primary" or "backup" (the secondary). */
export async function onCall(team: string, at: Date, shift: "primary" | "backup"): Promise<Recipient[]> {
  const day = new Date(`${londonParts(at).date}T00:00:00.000Z`);
  const rows = await prisma.onCallSchedule.findMany({
    where: { team, shiftType: shift, date: { gte: day, lt: new Date(day.getTime() + 86_400_000) } },
    select: { employee: { select: { email: true, active: true } } },
  });
  return rows.filter((r) => r.employee.active).map((r) => ({ email: r.employee.email }));
}

export async function recipientsForRole(role: EscalationStep["notifyRole"], team: string, at: Date): Promise<Recipient[]> {
  switch (role) {
    case "lead": return teamLeads(team);
    case "admin": return admins();
    case "oncall_primary": return onCall(team, at, "primary");
    case "oncall_secondary": return onCall(team, at, "backup");
  }
}

async function slackUserId(email: string): Promise<string | null> {
  try {
    const res = await getSlackClient()?.users.lookupByEmail({ email });
    return res?.user?.id ?? null;
  } catch {
    return null;
  }
}

function alertLink(alert: AlertWithTicket): string {
  const base = (env("NEXTAUTH_URL") ?? "").replace(/\/+$/, "");
  return alert.workItemId ? `${base}/work/${alert.workItemId}` : `${base}/admin/alerts`;
}

function alertText(alert: AlertWithTicket): string {
  return [
    `${alert.ruleCode} (${alert.severity}): ${alert.message}`,
    alert.detail,
    alert.workItem?.ticketKey ? `Ticket: ${alert.workItem.ticketKey}${alert.workItem.ticketUrl ? ` ${alert.workItem.ticketUrl}` : ""}` : "",
    `Open in KOMmand Centre: ${alertLink(alert)}`,
  ].filter(Boolean).join("\n");
}

/** Slack DM and email to each recipient. Failures are logged (counts only, no addresses: H8). */
export async function notifyPeople(people: Recipient[], alert: AlertWithTicket, prefix = ""): Promise<number> {
  const text = `${prefix}${alertText(alert)}`;
  let sent = 0;
  for (const p of people) {
    try {
      const userId = await slackUserId(p.email);
      if (userId) await getSlackClient()?.chat.postMessage({ channel: userId, text });
      await sendEmailNotification(p.email, `[${alert.severity.toUpperCase()}] ${alert.ruleCode}: ${alert.message}`.slice(0, 200), text);
      sent++;
    } catch (error) {
      logger.warn("Alert notification failed for one recipient", { ruleCode: alert.ruleCode, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return sent;
}

/** Extra targets from AlertRule.route: "slack:<channelId>", "email:<address>", "role:<lead|admin|oncall_primary|oncall_secondary>". */
async function routeTargets(targets: string[], alert: AlertWithTicket, team: string, at: Date) {
  for (const t of targets) {
    const [kind, value] = [t.slice(0, t.indexOf(":")), t.slice(t.indexOf(":") + 1)];
    try {
      if (kind === "slack" && value) await getSlackClient()?.chat.postMessage({ channel: value, text: alertText(alert) });
      else if (kind === "email" && value) await notifyPeople([{ email: value }], alert);
      else if (kind === "role" && ["lead", "admin", "oncall_primary", "oncall_secondary"].includes(value)) {
        await notifyPeople(await recipientsForRole(value as EscalationStep["notifyRole"], team, at), alert);
      }
    } catch (error) {
      logger.warn("Alert route target failed", { ruleCode: alert.ruleCode, kind, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

function routeList(route: unknown, key: "businessHours" | "outOfHours"): string[] {
  const r = route && typeof route === "object" ? (route as Record<string, unknown>)[key] : undefined;
  return Array.isArray(r) ? r.filter((x): x is string => typeof x === "string") : [];
}

export type NotifyOutcome = "quiet" | "digest" | "business_hours" | "out_of_hours" | "no_rule";

/** Route one alert's notification (new alert or a re-fire). */
export async function notifyAlert(alertId: string, now = new Date()): Promise<NotifyOutcome> {
  const alert = await prisma.alert.findUnique({ where: { id: alertId }, include: { workItem: { select: { id: true, ticketKey: true, ticketUrl: true } } } });
  if (!alert) return "no_rule";
  const rule = await prisma.alertRule.findUnique({ where: { code: alert.ruleCode } });
  const def = RULE_CATALOGUE[alert.ruleCode];
  if (!rule) return "no_rule";

  const quietMins = await getSetting("alerting.quietMins");
  if (alert.lastNotifiedAt && now.getTime() - alert.lastNotifiedAt.getTime() < quietMins * 60_000) return "quiet";
  if (def?.digest && alert.severity !== "high" && alert.severity !== "critical") return "digest";

  const params = effectiveParams(alert.ruleCode, rule.params);
  const team = def?.ownerTeam ?? TEAMS.txOps;
  const business = await isBusinessTime(String(params.calendar ?? "business_uk"), now);
  let outcome: NotifyOutcome;

  if (business) {
    const mentions: string[] = [];
    if (alert.severity === "high" || alert.severity === "critical") {
      for (const lead of await teamLeads(team)) {
        const id = await slackUserId(lead.email);
        if (id) mentions.push(`<@${id}>`);
      }
    }
    try {
      await postAlertToSlack({
        ruleCode: alert.ruleCode,
        severity: alert.severity,
        message: `${mentions.length ? `${mentions.join(" ")} ` : ""}${alert.message}${alert.detail ? `\n${alert.detail}` : ""}`,
        workItemId: alert.workItemId,
        ticketKey: alert.workItem?.ticketKey,
        ticketUrl: alert.workItem?.ticketUrl,
      });
    } catch (error) {
      logger.warn("Could not post alert to Slack", { ruleCode: alert.ruleCode, error: error instanceof Error ? error.message : String(error) });
    }
    await routeTargets(routeList(rule.route, "businessHours"), alert, team, now);
    outcome = "business_hours";
  } else {
    await notifyPeople(await onCall(team, now, "primary"), alert, "Out of hours: ");
    await routeTargets(routeList(rule.route, "outOfHours"), alert, team, now);
    outcome = "out_of_hours";
  }

  await prisma.alert.update({ where: { id: alert.id }, data: { lastNotifiedAt: now } });
  return outcome;
}

function ladder(params: Record<string, unknown>): EscalationStep[] {
  const v = params.escalation;
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is EscalationStep =>
    !!s && typeof s === "object" && typeof (s as EscalationStep).afterMins === "number" && ["lead", "admin", "oncall_primary", "oncall_secondary"].includes((s as EscalationStep).notifyRole));
}

/**
 * Escalate open, unacknowledged alerts: walk each rule's ladder, and out of
 * hours move critical alerts on to the secondary and lead when not
 * acknowledged within the window.
 */
export async function runEscalations(now = new Date()): Promise<{ escalated: number }> {
  const open = await prisma.alert.findMany({
    where: { status: "active" },
    include: { workItem: { select: { id: true, ticketKey: true, ticketUrl: true } } },
    take: 1000,
  });
  if (!open.length) return { escalated: 0 };
  const rules = new Map<string, AlertRule>((await prisma.alertRule.findMany({ where: { code: { in: [...new Set(open.map((a) => a.ruleCode))] } } })).map((r) => [r.code, r]));
  const ackMins = await getSetting("alerting.oohAckMins");
  let escalated = 0;

  for (const alert of open) {
    const rule = rules.get(alert.ruleCode);
    if (!rule?.enabled) continue;
    const def = RULE_CATALOGUE[alert.ruleCode];
    const team = def?.ownerTeam ?? TEAMS.txOps;
    const params = effectiveParams(alert.ruleCode, rule.params);
    const steps = ladder(params);
    const age = (now.getTime() - alert.firstFiredAt.getTime()) / 60_000;
    let step = alert.escalationStep;
    let changed = false;

    while (step < steps.length && age >= steps[step].afterMins) {
      await notifyPeople(await recipientsForRole(steps[step].notifyRole, team, now), alert, `Escalation (${steps[step].notifyRole}): `);
      step++;
      changed = true;
    }

    if (alert.severity === "critical" && !alert.escalatedAt && age >= ackMins) {
      const ooh = !(await isBusinessTime(String(params.calendar ?? "business_uk"), alert.firstFiredAt));
      if (ooh) {
        const people = [...(await onCall(team, now, "backup")), ...(await teamLeads(team))];
        await notifyPeople(people, alert, `Not acknowledged within ${ackMins} minutes: `);
        await prisma.alert.update({ where: { id: alert.id }, data: { escalatedAt: now } });
        escalated++;
      }
    }

    if (changed) {
      await prisma.alert.update({ where: { id: alert.id }, data: { escalationStep: step, escalatedAt: alert.escalatedAt ?? now } });
      escalated++;
    }
  }
  return { escalated };
}

/** Job `alert_digest` (08:00 London): one post listing open digest-rule alerts not yet digested today. */
export async function runAlertDigest(now = new Date()): Promise<{ alerts: number; posted: boolean }> {
  const codes = Object.values(RULE_CATALOGUE).filter((d) => d.digest).map((d) => d.code);
  const enabled = new Set((await prisma.alertRule.findMany({ where: { code: { in: codes }, enabled: true }, select: { code: true } })).map((r) => r.code));
  const since = new Date(now.getTime() - 20 * 3_600_000);
  const alerts = await prisma.alert.findMany({
    where: { ruleCode: { in: [...enabled] }, status: { not: "resolved" }, OR: [{ digestedAt: null }, { digestedAt: { lt: since } }] },
    orderBy: { firstFiredAt: "asc" },
    take: 100,
  });
  if (!alerts.length) return { alerts: 0, posted: false };
  let posted = false;
  try {
    posted = await postAlertToSlack({
      ruleCode: "DIGEST",
      severity: "medium",
      message: `Daily digest: ${alerts.length} open configuration alert(s)\n${alerts.map((a) => `• ${a.ruleCode}: ${a.message}`).join("\n")}`,
    });
  } catch (error) {
    logger.warn("Could not post the alert digest", { error: error instanceof Error ? error.message : String(error) });
  }
  await prisma.alert.updateMany({ where: { id: { in: alerts.map((a) => a.id) } }, data: { digestedAt: now } });
  return { alerts: alerts.length, posted };
}
