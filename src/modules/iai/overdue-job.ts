import { prisma } from "@/lib/prisma";
import { raiseAlert } from "@/modules/alerting/raise";

/** Job `iai_overdue`: raise ALR-IAI-01 for each draft past due (spec §10.4); the rule routes to role admin. */
export async function checkOverdueIaiDrafts(now = new Date()): Promise<{ overdue: number }> {
  const overdue = await prisma.iaiDraft.findMany({
    where: { completedAt: null, dueAt: { lt: now } },
    include: { workItem: { select: { title: true, ticketKey: true } } },
  });
  for (const d of overdue) {
    await raiseAlert({
      ruleCode: "ALR-IAI-01",
      dedupeKey: d.id,
      message: `IAI draft ${d.jiraKey ?? "(not yet in Jira)"} for ${d.workItem.ticketKey ?? d.workItem.title} is overdue (due ${d.dueAt.toISOString()}).`,
    });
  }
  return { overdue: overdue.length };
}
