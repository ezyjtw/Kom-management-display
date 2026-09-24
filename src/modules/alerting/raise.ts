import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { AlertSeverity } from "@prisma/client";
import { ensureAlertTicket } from "@/modules/work-items/tickets";
import { maybeCreateIaiDraftForAlert } from "@/modules/iai/drafts";
import { notifyAlert } from "@/modules/alerting/routing";
import { getSetting } from "@/modules/settings/settings";

export interface AlertCandidateInput {
  ruleCode: string;
  dedupeKey: string;
  message: string;
  detail?: string;
  severity?: AlertSeverity;
  priority?: string;
  /** Link to an existing WorkItem (its ticket is reused, no alert ticket is opened). */
  workItemId?: string;
}

async function safe(what: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    logger.warn(`raiseAlert: ${what} failed`, { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Raise (or re-fire) the open alert for (ruleCode, dedupeKey) from an event or
 * job (the engine's evaluators use applyCandidates instead). Rules ship
 * disabled (spec §11.1): if the AlertRule is missing or disabled nothing is
 * raised. Returns the alert id, or null when the rule is off. Ticketing and
 * notification failures never stop the alert from being raised. A re-fire
 * increments fireCount but comments and re-notifies only outside the quiet
 * window (spec §11.3).
 */
export async function raiseAlert(input: AlertCandidateInput): Promise<string | null> {
  const rule = await prisma.alertRule.findUnique({ where: { code: input.ruleCode } });
  if (!rule?.enabled) {
    logger.debug("Alert rule disabled; not raising", { ruleCode: input.ruleCode });
    return null;
  }

  const now = new Date();
  const open = await prisma.alert.findFirst({
    where: { ruleCode: input.ruleCode, dedupeKey: input.dedupeKey, status: { not: "resolved" } },
  });
  if (open) {
    await prisma.alert.update({
      where: { id: open.id },
      data: { lastFiredAt: now, fireCount: { increment: 1 }, ...(input.detail ? { detail: input.detail } : {}) },
    });
    const quietMins = await getSetting("alerting.quietMins");
    if (!open.lastNotifiedAt || now.getTime() - open.lastNotifiedAt.getTime() >= quietMins * 60_000) {
      await ensureAlertTicket(open.id, { repeat: true });
      await safe("notify", () => notifyAlert(open.id, now));
    }
    return open.id;
  }

  let id: string;
  try {
    const alert = await prisma.alert.create({
      data: {
        type: input.ruleCode,
        ruleCode: input.ruleCode,
        dedupeKey: input.dedupeKey,
        message: input.message,
        detail: input.detail ?? "",
        severity: input.severity ?? (rule.severity as AlertSeverity),
        priority: input.priority ?? "P2",
        workItemId: input.workItemId ?? null,
      },
    });
    id = alert.id;
  } catch (error) {
    // Lost a race with another raiser: the partial unique index kept one open alert.
    const again = await prisma.alert.findFirst({
      where: { ruleCode: input.ruleCode, dedupeKey: input.dedupeKey, status: { not: "resolved" } },
    });
    if (again) return again.id;
    throw error;
  }

  // Spec §10.1: every alert that fires is ticketed; some also open an IAI draft (§10.4).
  await ensureAlertTicket(id, { repeat: false });
  await maybeCreateIaiDraftForAlert(id);
  await safe("notify", () => notifyAlert(id, now));
  return id;
}
