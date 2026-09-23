import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { AlertSeverity } from "@prisma/client";
import { ensureAlertTicket } from "@/modules/work-items/tickets";
import { maybeCreateIaiDraftForAlert } from "@/modules/iai/drafts";

export interface AlertCandidateInput {
  ruleCode: string;
  dedupeKey: string;
  message: string;
  severity?: AlertSeverity;
  priority?: string;
}

/**
 * Raise (or re-fire) the open alert for (ruleCode, dedupeKey). Rules ship
 * disabled (spec §11.1): if the AlertRule is missing or disabled nothing is
 * raised. Returns the alert id, or null when the rule is off. Ticketing
 * failures never stop the alert from being raised.
 */
export async function raiseAlert(input: AlertCandidateInput): Promise<string | null> {
  const rule = await prisma.alertRule.findUnique({ where: { code: input.ruleCode } });
  if (!rule?.enabled) {
    logger.debug("Alert rule disabled; not raising", { ruleCode: input.ruleCode });
    return null;
  }

  const open = await prisma.alert.findFirst({
    where: { ruleCode: input.ruleCode, dedupeKey: input.dedupeKey, status: { not: "resolved" } },
  });
  if (open) {
    await prisma.alert.update({
      where: { id: open.id },
      data: { lastFiredAt: new Date(), fireCount: { increment: 1 } },
    });
    await ensureAlertTicket(open.id, { repeat: true });
    return open.id;
  }

  try {
    const alert = await prisma.alert.create({
      data: {
        type: input.ruleCode,
        ruleCode: input.ruleCode,
        dedupeKey: input.dedupeKey,
        message: input.message,
        severity: input.severity ?? (rule.severity as AlertSeverity),
        priority: input.priority ?? "P2",
      },
    });
    // Spec §10.1: every alert that fires is ticketed; some also open an IAI draft (§10.4).
    await ensureAlertTicket(alert.id, { repeat: false });
    await maybeCreateIaiDraftForAlert(alert.id);
    return alert.id;
  } catch (error) {
    // Lost a race with another raiser: the partial unique index kept one open alert.
    const again = await prisma.alert.findFirst({
      where: { ruleCode: input.ruleCode, dedupeKey: input.dedupeKey, status: { not: "resolved" } },
    });
    if (again) return again.id;
    throw error;
  }
}
