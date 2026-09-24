/**
 * UAT outcomes and GXS defects (spec §16.5). A failed item needs a GXS defect:
 * KOMmand Centre can draft it, and the tester confirms before it is created.
 * Testing itself happens in GX UAT, by people; nothing here touches GX (H1).
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
    data: { metadata: { ...m, uatOutcome: uat.outcome, uatEvidence: uat.evidence, ...(uat.defectKey ? { gxsDefectKey: uat.defectKey } : {}) } as Prisma.InputJsonValue },
  });
  const changeId = typeof m.gxChangeId === "string" ? m.gxChangeId : null;
  if (changeId) await prisma.gxChange.updateMany({ where: { OR: [{ id: changeId }, { workItemId: item.id }] }, data: { uatOutcome: uat.outcome } });
  if (uat.outcome === "fail" && uat.defectKey) {
    if (item.ticketKey) {
      try {
        await linkIssues(item.ticketKey, uat.defectKey);
      } catch (error) {
        logger.warn("Linking the GXS defect failed", { error: error instanceof Error ? error.message : String(error) });
      }
    }
    await raiseAlert({ ruleCode: "ALR-UAT-03", dedupeKey: item.id, message: `UAT failed: ${item.title}. GXS defect ${uat.defectKey}.`, workItemId: item.id });
  }
}

/** Pre-filled GXS defect for a UAT item; shown to the tester, never sent without confirmation. */
export async function defectDraft(workItemId: string): Promise<{ summary: string; description: string; project: string }> {
  const item = await prisma.workItem.findUnique({ where: { id: workItemId } });
  if (!item || item.kind !== "uat_task") throw new DefectError("UAT item not found.", 404);
  const m = meta(item);
  const change = typeof m.gxChangeId === "string" ? await prisma.gxChange.findUnique({ where: { id: m.gxChangeId } }) : null;
  const sprint = typeof m.gxSprint === "string" ? m.gxSprint : "?";
  return {
    project: "GXS",
    summary: `[Sprint ${sprint} UAT] ${change?.summary ?? item.title}`.slice(0, 255),
    description: [
      `Found during Transaction Operations UAT of GX Sprint ${sprint} (UAT ticket ${item.ticketKey ?? "n/a"}).`,
      change ? `Change item (${change.section}): ${change.summary}` : "",
      change && Array.isArray(change.gxJiraKeys) && change.gxJiraKeys.length ? `Related GX tickets: ${(change.gxJiraKeys as string[]).join(", ")}` : "",
      "Steps to reproduce: (tester to complete)",
      "Expected: (tester to complete)",
      "Actual: (tester to complete)",
      "Environment: GX UAT",
    ].filter(Boolean).join("\n\n"),
  };
}

export const defectSchema = z.object({
  summary: z.string().trim().min(5).max(255),
  description: z.string().trim().min(10).max(10000),
  confirm: z.literal(true),
});

/** Create the GXS defect the tester has reviewed and confirmed, and link it to the UAT ticket. */
export async function createDefect(workItemId: string, input: z.infer<typeof defectSchema>): Promise<{ key: string; url: string | null }> {
  const item = await prisma.workItem.findUnique({ where: { id: workItemId } });
  if (!item || item.kind !== "uat_task") throw new DefectError("UAT item not found.", 404);
  if (typeof meta(item).gxsDefectKey === "string") throw new DefectError(`A GXS defect is already linked (${meta(item).gxsDefectKey}).`, 409);
  const project = await prisma.jiraProjectConfig.findUnique({ where: { key: "GXS" } });
  const types = (project?.issueTypeIds ?? {}) as Record<string, string>;
  const issueTypeId = types.Bug || types._default;
  if (!project || !issueTypeId) throw new DefectError("GXS is not configured for defect creation (Admin → Jira projects: GXS with a Bug or default issue type). Create the defect in Jira and enter its key.", 409);
  const created = await createIssue({ projectKey: "GXS", issueTypeId, summary: input.summary, description: input.description, labels: ["kommand-centre", "uat-defect", ...(typeof meta(item).gxSprint === "string" ? [`Sprint_${meta(item).gxSprint}`] : [])] });
  await prisma.workItem.update({ where: { id: item.id }, data: { metadata: { ...meta(item), gxsDefectKey: created.key } as Prisma.InputJsonValue } });
  if (item.ticketKey) {
    try {
      await linkIssues(item.ticketKey, created.key);
    } catch (error) {
      logger.warn("Linking the new GXS defect failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { key: created.key, url: browseUrl(created.key) };
}
