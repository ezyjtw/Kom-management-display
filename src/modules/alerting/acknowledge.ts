/**
 * Spec §10.2: an alert can only be acknowledged once it is tied to a WorkItem
 * that has a ticket. Auto-created alert tickets satisfy this.
 */

import { prisma } from "@/lib/prisma";

export const ACK_REQUIRES_TICKET_MESSAGE =
  "This alert cannot be acknowledged until it is linked to a work item with a Jira/JSM ticket. Raise or link a ticket first.";

/** null when the alert may be acknowledged, otherwise the reason it may not. */
export async function acknowledgeBlocker(alertId: string): Promise<string | null> {
  const alert = await prisma.alert.findUnique({
    where: { id: alertId },
    select: { workItem: { select: { ticketKey: true } } },
  });
  if (!alert) return "Alert not found.";
  return alert.workItem?.ticketKey ? null : ACK_REQUIRES_TICKET_MESSAGE;
}
