/**
 * CHK-02 (spec §12): close the daily TOPS MTD ticket once every break for the
 * day is resolved or explained (closed with a write-up), as a comment plus a
 * transition. The close uses the standard write-up rules; the risk score comes
 * from setting mtd.autoCloseRiskScore (TODO(CONFIRM-RISK-SCORE-SCALE)). While
 * it is empty the job only comments and leaves the close to the Team 2 lead.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getSetting } from "@/modules/settings/settings";
import { changeState, commentInternal } from "@/modules/work-items/ticket-writeback";
import { DAILY_REPORT_SOURCE } from "@/modules/daily-checks/enforcement";

const DONE = ["resolved", "closed"];

export async function autoCloseDailyMtdTickets(now = new Date()): Promise<{ closed: number; readyForLead: number }> {
  const items = await prisma.dailyCheckItem.findMany({
    where: { definitionCode: { in: ["CHK-02", "CHK-02-DEV"] }, status: "issues_found", createdAt: { gte: new Date(now.getTime() - 14 * 86_400_000) } },
  });
  const riskScore = await getSetting("mtd.autoCloseRiskScore");
  let closed = 0;
  let readyForLead = 0;

  for (const item of items) {
    const report = await prisma.workItem.findUnique({ where: { sourceSystem_sourceId: { sourceSystem: DAILY_REPORT_SOURCE, sourceId: `${item.definitionCode}:${item.periodKey}` } } });
    if (!report?.ticketKey || DONE.includes(report.state)) continue;
    const ids = Array.isArray(item.exceptionWorkItemIds) ? (item.exceptionWorkItemIds as string[]) : [];
    if (!ids.length) continue;
    const breaks = await prisma.workItem.findMany({ where: { id: { in: ids } }, select: { state: true } });
    if (breaks.length !== ids.length || breaks.some((b) => !DONE.includes(b.state))) continue;

    const meta = (report.metadata ?? {}) as Record<string, unknown>;
    const note = `All ${ids.length} MTD break(s) for ${item.periodKey} are resolved or explained.`;
    try {
      if (!meta.autoCloseCommentedAt) {
        await commentInternal(report.id, `${note} ${riskScore ? "Closing automatically." : "Ready for the Team 2 lead to close."}`);
        await prisma.workItem.update({ where: { id: report.id }, data: { metadata: { ...meta, autoCloseCommentedAt: now.toISOString() } as Prisma.InputJsonValue } });
      }
      if (!riskScore) {
        readyForLead++;
        continue;
      }
      const writeUp = { resolutionNote: `${note} Closed automatically by KOMmand Centre.`, rootCause: "no_action_required", riskScore };
      await changeState(report.id, "closed", { closure: { writeUp } });
      await prisma.workItem.update({ where: { id: report.id }, data: { resolutionNote: writeUp.resolutionNote, rootCause: writeUp.rootCause, riskScore } });
      closed++;
    } catch (error) {
      logger.warn("Could not auto-close the daily MTD ticket", { workItemId: report.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { closed, readyForLead };
}
