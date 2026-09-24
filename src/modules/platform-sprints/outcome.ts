/**
 * UAT outcomes and PDEF defects (spec §16.5). A failed item needs a PDEF defect:
 * KOMmand Centre can draft it, and the tester confirms before it is created.
 * Testing itself happens in Platform UAT, by people; nothing here touches Platform (H1).
 */

import type { Prisma, WorkItem } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { browseUrl, createIssue, linkIssues } from "@/lib/integrations/atlassian/client";
import { raiseAlert } from "@/modules/alerting/raise";

export class DefectError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
    this.name = "DefectError";
  }
}

const meta = (w: Pick<WorkItem, "metadata">) => (w.metadata ?? {}) as Record<string, unknown>;

/** After a UAT child is closed: store the outcome, update the change item, link the defect, raise ALR-UAT-03 on fail. */
export async function recordUatOutcome(item: WorkItem, uat: { outcome: string; evidence: string; defectKey?: string }): Promise<void> {
  const m = meta(item);
  await prisma.workItem.update({
    where: { id: item.id },
    data: { metadata: { ...m, uatOutcome: uat.outcome, uatEvidence: uat.evidence, ...(uat.defectKey ? { platformDefectDefectKey: uat.defectKey } : {}) } as Prisma.InputJsonValue },
  });
  const changeId = typeof m.platformChangeId === "string" ? m.platformChangeId : null;
  if (changeId) await prisma.platformChange.updateMany({ where: { OR: [{ id: changeId }, { workItemId: item.id }] }, data: { uatOutcome: uat.outcome } });
  if (uat.outcome === "fail" && uat.defectKey) {
    if (item.ticketKey) {
      try {
        await linkIssues(item.ticketKey, uat.defectKey);
      } catch (error) {
        logger.warn("Linking the PDEF defect failed", { error: error instanceof Error ? error.message : String(error) });
      }
    }
    await raiseAlert({ ruleCode: "ALR-UAT-03", dedupeKey: item.id, message: `UAT failed: ${item.title}. PDEF defect ${uat.defectKey}.`, workItemId: item.id });
  }
}

/** Pre-filled PDEF defect for a UAT item; shown to the tester, never sent without confirmation. */
export async function defectDraft(workItemId: string): Promise<{ summary: string; description: string; project: string }> {
  const item = await prisma.workItem.findUnique({ where: { id: workItemId } });
  if (!item || item.kind !== "uat_task") throw new DefectError("UAT item not found.", 404);
  const m = meta(item);
  const change = typeof m.platformChangeId === "string" ? await prisma.platformChange.findUnique({ where: { id: m.platformChangeId } }) : null;
  const sprint = typeof m.platformSprint === "string" ? m.platformSprint : "?";
  return {
    project: "PDEF",
    summary: `[Sprint ${sprint} UAT] ${change?.summary ?? item.title}`.slice(0, 255),
    description: [
      `Found during Transaction Operations UAT of Platform Sprint ${sprint} (UAT ticket ${item.ticketKey ?? "n/a"}).`,
      change ? `Change item (${change.section}): ${change.summary}` : "",
      change && Array.isArray(change.platformJiraKeys) && change.platformJiraKeys.length ? `Related Platform tickets: ${(change.platformJiraKeys as string[]).join(", ")}` : "",
      "Steps to reproduce: (tester to complete)",
      "Expected: (tester to complete)",
      "Actual: (tester to complete)",
      "Environment: Platform UAT",
    ].filter(Boolean).join("\n\n"),
  };
}

export const defectSchema = z.object({
  summary: z.string().trim().min(5).max(255),
  description: z.string().trim().min(10).max(10000),
  confirm: z.literal(true),
});

/** Create the PDEF defect the tester has reviewed and confirmed, and link it to the UAT ticket. */
export async function createDefect(workItemId: string, input: z.infer<typeof defectSchema>): Promise<{ key: string; url: string | null }> {
  const item = await prisma.workItem.findUnique({ where: { id: workItemId } });
  if (!item || item.kind !== "uat_task") throw new DefectError("UAT item not found.", 404);
  if (typeof meta(item).platformDefectDefectKey === "string") throw new DefectError(`A PDEF defect is already linked (${meta(item).platformDefectDefectKey}).`, 409);
  const project = await prisma.jiraProjectConfig.findUnique({ where: { key: "PDEF" } });
  const types = (project?.issueTypeIds ?? {}) as Record<string, string>;
  const issueTypeId = types.Bug || types._default;
  if (!project || !issueTypeId) throw new DefectError("PDEF is not configured for defect creation (Admin → Jira projects: PDEF with a Bug or default issue type). Create the defect in Jira and enter its key.", 409);
  const created = await createIssue({ projectKey: "PDEF", issueTypeId, summary: input.summary, description: input.description, labels: ["kommand-centre", "uat-defect", ...(typeof meta(item).platformSprint === "string" ? [`Sprint_${meta(item).platformSprint}`] : [])] });
  await prisma.workItem.update({ where: { id: item.id }, data: { metadata: { ...meta(item), platformDefectDefectKey: created.key } as Prisma.InputJsonValue } });
  if (item.ticketKey) {
    try {
      await linkIssues(item.ticketKey, created.key);
    } catch (error) {
      logger.warn("Linking the new PDEF defect failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { key: created.key, url: browseUrl(created.key) };
}
