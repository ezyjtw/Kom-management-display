/** /platform-sprints view model (spec §16.7): dates, items by type, mapping to tasks, UAT status and the gate. */

import { prisma } from "@/lib/prisma";

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export async function sprintsView() {
  const sprints = await prisma.platformSprint.findMany({ orderBy: { sprint: "desc" }, take: 20 });
  const changes = await prisma.platformChange.findMany({ where: { sprintId: { in: sprints.map((s) => s.id) } }, orderBy: { createdAt: "asc" } });
  return sprints.map((s) => {
    const mine = changes.filter((c) => c.sprintId === s.id);
    const active = mine.filter((c) => !c.removedAt);
    const qualifying = active.filter((c) => c.qualifies);
    const outcomes = { pass: 0, fail: 0, not_applicable: 0, blocked: 0, open: 0 } as Record<string, number>;
    for (const c of qualifying) outcomes[c.uatOutcome ?? "open"]++;
    const byType: Record<string, number> = {};
    for (const c of active) byType[c.itemType] = (byType[c.itemType] ?? 0) + 1;
    return {
      id: s.id,
      sprint: s.sprint,
      releaseNotesUrl: s.releaseNotesUrl,
      pageVersion: s.pageVersion,
      uatLandedAt: s.uatLandedAt?.toISOString() ?? null,
      prodPlannedAt: s.prodPlannedAt?.toISOString() ?? null,
      parentTicketKey: s.parentTicketKey,
      byType,
      outcomes,
      // Green once every qualifying item has an outcome and none failed (spec §16.7).
      gate: qualifying.length > 0 && outcomes.open === 0 && outcomes.fail === 0 ? "green" : qualifying.length === 0 ? "none" : outcomes.fail > 0 ? "red" : "amber",
      tasks: [...new Set(qualifying.flatMap((c) => strings(c.affectedTasks)))].sort(),
      items: active.map((c) => ({
        id: c.id, section: c.section, itemType: c.itemType, summary: c.summary, qualifies: c.qualifies, tags: strings(c.tags), team: c.team, priority: c.priority,
        affectedTasks: strings(c.affectedTasks), uatTicketKey: c.uatTicketKey, workItemId: c.workItemId, uatOutcome: c.uatOutcome,
      })),
      removed: mine.filter((c) => c.removedAt && !mine.some((n) => n.predecessorId === c.id)).map((c) => ({ id: c.id, summary: c.summary, uatTicketKey: c.uatTicketKey })),
    };
  });
}
