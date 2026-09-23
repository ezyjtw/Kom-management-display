import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { AlertSeverity } from "@prisma/client";

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
 * raised. Returns the alert id, or null when the rule is off.
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
