/**
 * Platform sprint UAT alerts evaluated on a clock (spec §16.6). The event rules
 * (ALR-UAT-01, 03, 04, 05) are raised by the intake and the outcome capture.
 */

import { prisma } from "@/lib/prisma";
import { addBusinessDays, loadCalendar, londonInstant, londonParts } from "@/modules/alerting/calendar";
import { numParam, type AlertCandidate, type EvaluatorContext } from "@/modules/alerting/types";

/** ALR-UAT-02: a qualifying change still has no outcome once PROD − 2 business days is reached. */
export async function evaluateUatBeforeProd(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const days = numParam(ctx.params, "businessDaysBeforeProd", 2);
  const sprints = await prisma.platformSprint.findMany({ where: { prodPlannedAt: { not: null } } });
  if (!sprints.length) return [];
  const changes = await prisma.platformChange.findMany({ where: { sprintId: { in: sprints.map((s) => s.id) }, removedAt: null, qualifies: true } });
  const cal = await loadCalendar("business_uk", new Date(ctx.now.getTime() - 60 * 86_400_000), new Date(ctx.now.getTime() + 60 * 86_400_000));
  const out: AlertCandidate[] = [];
  for (const s of sprints) {
    const gate = londonInstant(addBusinessDays(cal, londonParts(s.prodPlannedAt!).date, -days), 0);
    if (ctx.now < gate) continue;
    const mine = changes.filter((c) => c.sprintId === s.id);
    const open = mine.filter((c) => !c.uatOutcome);
    if (!open.length) continue;
    out.push({
      dedupeKey: s.sprint,
      severity: "high",
      title: `Platform Sprint ${s.sprint}: UAT not complete before PROD`,
      detail: `${open.length} of ${mine.length} UAT item(s) have no outcome and PROD is planned for ${londonParts(s.prodPlannedAt!).date}: ${open.slice(0, 10).map((c) => c.uatTicketKey ?? c.summary).join(", ")}.`,
      ...(s.parentWorkItemId ? { workItemId: s.parentWorkItemId } : { workItemSeed: { kind: "internal_task" as const, taskCode: "UAT" } }),
    });
  }
  return out;
}

/** ALR-HB-RELNOTES: a sprint has a CHG UAT ticket but no release-notes page after a day. */
export async function evaluateReleaseNotesMissing(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  const graceHours = numParam(ctx.params, "graceHours", 24);
  const sprints = await prisma.platformSprint.findMany({ where: { pageVersion: 0, createdAt: { lt: new Date(ctx.now.getTime() - graceHours * 3_600_000) } } });
  return sprints
    .filter((s) => Array.isArray(s.changeKeys) && s.changeKeys.length > 0)
    .map((s) => ({
      dedupeKey: s.sprint,
      severity: "medium" as const,
      title: `Platform Sprint ${s.sprint}: release notes not found`,
      detail: `CHG has change tickets for Sprint ${s.sprint} (${(s.changeKeys as string[]).join(", ")}) but no "[Platform] Sprint ${s.sprint} Release Notes" page was found. Check the page title and the release-notes parent (CONFIRM-PLATFORM-RELEASE-PARENT).`,
      workItemSeed: { kind: "internal_task" as const, taskCode: "UAT" },
    }));
}
