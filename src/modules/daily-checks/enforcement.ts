/**
 * Daily check rules (spec §10.2):
 * - `pass` needs evidence (recordCount, dataAsOf, source) that is fresh enough;
 * - `issues_found` is only reached by recording structured exceptions, each of
 *   which becomes a WorkItem with a ticket;
 * - `skipped` needs a reason and approval by a different lead or admin; until
 *   then the item stays `pending`.
 */

import { Prisma, type DailyCheckItem, type WorkItemKind } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/modules/settings/settings";
import { ensureTicketedWorkItem } from "@/modules/work-items/tickets";

export class DailyCheckRuleError extends Error {
  constructor(readonly issues: string[], readonly status: 404 | 409 | 422 = 422) {
    super(issues.join(" "));
    this.name = "DailyCheckRuleError";
  }
}

export const passEvidenceSchema = z.object({
  recordCount: z.number().int().min(0),
  dataAsOf: z.string().datetime({ offset: true }),
  source: z.string().trim().min(1).max(200),
  /** Further fields named by the definition's evidenceSpec.requiredFields. */
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type PassEvidence = z.infer<typeof passEvidenceSchema>;

export const exceptionRowSchema = z.object({
  summary: z.string().trim().min(5).max(200),
  /** CHK-02: OTC break type code (OtcBreakType). */
  breakType: z.string().trim().max(60).optional(),
  detail: z.string().trim().max(4000).optional(),
  reference: z.string().trim().max(200).optional(),
  clientId: z.string().max(100).optional(),
});
export type ExceptionRow = z.infer<typeof exceptionRowSchema>;

/**
 * DailyCheckDefinition.evidenceSpec. TODO(CONFIRM-EVIDENCE-SPEC): per-check
 * fields are agreed with the team when definitions are seeded.
 */
const evidenceSpecSchema = z
  .object({
    freshnessMinutes: z.number().int().positive().optional(),
    requiredFields: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

async function loadItem(itemId: string) {
  const item = await prisma.dailyCheckItem.findUnique({ where: { id: itemId }, include: { definition: true } });
  if (!item) throw new DailyCheckRuleError(["Daily check item not found."], 404);
  return item;
}

async function completeRunIfDone(runId: string) {
  const run = await prisma.dailyCheckRun.findUnique({ where: { id: runId }, include: { items: { select: { status: true } } } });
  if (run && !run.completedAt && run.items.every((i) => i.status !== "pending")) {
    await prisma.dailyCheckRun.update({ where: { id: run.id }, data: { completedAt: new Date() } });
  }
}

export async function passItem(itemId: string, evidence: unknown, operatorId: string, now = new Date()): Promise<DailyCheckItem> {
  const item = await loadItem(itemId);
  if (item.status !== "pending") throw new DailyCheckRuleError([`Item is already ${item.status}.`], 409);

  const parsed = passEvidenceSchema.safeParse(evidence);
  if (!parsed.success) {
    throw new DailyCheckRuleError([
      "A pass needs evidence: recordCount (a whole number, 0 allowed), dataAsOf (the source data timestamp) and source (where the data came from).",
    ]);
  }
  const ev = parsed.data;
  const spec = evidenceSpecSchema.safeParse(item.definition?.evidenceSpec ?? {});
  const freshnessMinutes = (spec.success && spec.data.freshnessMinutes) || (await getSetting("dailyChecks.defaultFreshnessMinutes"));
  const issues: string[] = [];

  const asOf = new Date(ev.dataAsOf);
  if (asOf.getTime() > now.getTime() + 5 * 60_000) issues.push("dataAsOf is in the future.");
  if (now.getTime() - asOf.getTime() > freshnessMinutes * 60_000) {
    issues.push(`The evidence is stale: data as of ${asOf.toISOString()} is older than the ${freshnessMinutes}-minute limit for this check.`);
  }
  const missing = (spec.success ? spec.data.requiredFields ?? [] : []).filter((f) => ev.fields?.[f] === undefined || ev.fields[f] === "");
  if (missing.length) issues.push(`Evidence is missing: ${missing.join(", ")}.`);
  if (issues.length) throw new DailyCheckRuleError(issues);

  const updated = await prisma.dailyCheckItem.update({
    where: { id: itemId },
    data: {
      status: "pass",
      recordCount: ev.recordCount,
      dataAsOf: asOf,
      evidence: { source: ev.source, fields: ev.fields ?? {}, recordedAt: now.toISOString() } as Prisma.InputJsonValue,
      operatorId,
      completedAt: now,
    },
  });
  await completeRunIfDone(item.runId);
  return updated;
}

/** Record exceptions: each becomes a WorkItem with a ticket; the item becomes issues_found. */
export async function recordExceptions(itemId: string, rows: ExceptionRow[], operatorId: string, now = new Date()): Promise<{ item: DailyCheckItem; workItemIds: string[]; unticketed: number }> {
  const item = await loadItem(itemId);
  if (item.status === "pass" || item.status === "skipped") throw new DailyCheckRuleError([`Item is already ${item.status}.`], 409);
  if (!rows.length) throw new DailyCheckRuleError(["Record at least one exception."]);

  const projectKey = item.definition?.ticketProject || (await getSetting("dailyChecks.defaultTicketProject"));
  const code = item.definitionCode ?? "";
  const kind = EXCEPTION_KIND[code] ?? "daily_check_exception";

  // CHK-02: every break carries a type from the admin-editable list (once the list exists).
  if (kind === "mtd_break") {
    const types = new Set((await prisma.otcBreakType.findMany({ where: { isActive: true }, select: { code: true } })).map((t) => t.code));
    const bad = rows.filter((r) => types.size > 0 && (!r.breakType || !types.has(r.breakType)));
    if (bad.length) throw new DailyCheckRuleError([`Each MTD break needs a break type from the list (${[...types].join(", ")}).`]);
  }
  const existing = Array.isArray(item.exceptionWorkItemIds) ? (item.exceptionWorkItemIds as string[]) : [];
  const taskCode = item.definitionCode ?? item.category;
  const ids: string[] = [];
  let unticketed = 0;

  for (const [i, row] of rows.entries()) {
    const isBreak = kind === "mtd_break";
    const breakType = isBreak ? row.breakType ?? "unclassified" : undefined;
    const wi = await ensureTicketedWorkItem({
      kind,
      title: `${item.name}: ${row.summary}`,
      team: item.definition?.team ?? "All",
      taskCode,
      sourceSystem: "daily_check",
      sourceId: `${item.id}:${existing.length + i + 1}`,
      clockStartedAt: now,
      clientId: row.clientId ?? null,
      metadata: {
        dailyCheckItemId: item.id, periodKey: item.periodKey, reference: row.reference ?? null, detail: row.detail ?? null,
        ...(isBreak ? { breakType, platformStatusVsChain: "unverified" } : {}),
      },
      slaPolicyCode: isBreak ? "MTD-BREAK" : undefined,
      ticket: {
        projectKey,
        summary: `[${taskCode}] ${isBreak ? `${breakType}: ` : ""}${row.summary}`,
        description: [
          `Daily check exception: ${item.name}`,
          isBreak ? `Break type: ${breakType}\nResolve by T+1 business day. Platform status vs chain unverified.` : "",
          row.reference ? `Reference: ${row.reference}` : "",
          row.detail ?? "",
        ].filter(Boolean).join("\n\n"),
        labels: ["daily-check-exception", `check-${taskCode.toLowerCase()}`, ...(isBreak ? [`break-${String(breakType).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`] : [])],
      },
    });
    if (!wi.ticketKey) unticketed++;
    ids.push(wi.id);
  }

  if (kind === "mtd_break") await ensureDailyMtdTicket(item, now);

  const updated = await prisma.dailyCheckItem.update({
    where: { id: itemId },
    data: {
      status: "issues_found",
      exceptionWorkItemIds: [...existing, ...ids] as Prisma.InputJsonValue,
      operatorId,
      completedAt: item.completedAt ?? now,
    },
  });
  await completeRunIfDone(item.runId);
  return { item: updated, workItemIds: ids, unticketed };
}

/** WorkItem kind for exceptions of each check (spec §12); others are daily_check_exception. */
export const EXCEPTION_KIND: Record<string, WorkItemKind> = {
  "CHK-02": "mtd_break",
  "CHK-02-DEV": "mtd_break",
  "CHK-06": "scam_dust_case",
  "CHK-09": "travel_rule_case",
  "CHK-09K": "realisation_case",
  "CHK-04": "screening_case",
  "CHK-16": "staking_exception",
  "CHK-21": "staking_exception",
  "CHK-22": "staking_exception",
};

export const DAILY_REPORT_SOURCE = "daily_check_report";

/** CHK-02: the daily OPS MTD ticket for the period (closed automatically once every break is resolved or explained). */
async function ensureDailyMtdTicket(item: DailyCheckItem & { definition: { team: string } | null }, now: Date) {
  const code = item.definitionCode ?? "CHK-02";
  await ensureTicketedWorkItem({
    kind: "report_task",
    title: `${item.name}: ${item.periodKey}`,
    team: item.definition?.team ?? "Team 2",
    taskCode: code,
    sourceSystem: DAILY_REPORT_SOURCE,
    sourceId: `${code}:${item.periodKey}`,
    clockStartedAt: now,
    metadata: { dailyCheckItemId: item.id },
    ticket: { projectKey: "OPS", summary: `Daily MTD variances ${item.periodKey}`, description: `MTD breaks for ${item.periodKey} are tracked as OTC tickets. This ticket closes when every break is resolved or explained.`, labels: ["mtd-daily"] },
  });
}

/** Ask to skip. The item stays pending until a different lead/admin approves. */
export async function requestSkip(itemId: string, reason: string | undefined, requestedBy: string): Promise<DailyCheckItem> {
  const item = await loadItem(itemId);
  if (item.status !== "pending") throw new DailyCheckRuleError([`Item is already ${item.status}.`], 409);
  if (!reason || reason.trim().length < 5) throw new DailyCheckRuleError(["Skipping needs a reason (at least 5 characters)."]);
  return prisma.dailyCheckItem.update({
    where: { id: itemId },
    data: { skippedReason: reason.trim(), skipRequestedBy: requestedBy, skipApprovedBy: null },
  });
}

export async function approveSkip(itemId: string, approver: { id: string; role: string }, now = new Date()): Promise<DailyCheckItem> {
  if (approver.role !== "lead" && approver.role !== "admin") throw new DailyCheckRuleError(["Only a lead or admin can approve a skip."], 422);
  const item = await loadItem(itemId);
  if (item.status !== "pending") throw new DailyCheckRuleError([`Item is already ${item.status}.`], 409);
  if (!item.skipRequestedBy || !item.skippedReason) throw new DailyCheckRuleError(["No skip has been requested for this item."]);
  if (item.skipRequestedBy === approver.id) throw new DailyCheckRuleError(["A skip must be approved by a different person from the one who requested it."]);
  const updated = await prisma.dailyCheckItem.update({
    where: { id: itemId },
    data: { status: "skipped", skipApprovedBy: approver.id, completedAt: now },
  });
  await completeRunIfDone(item.runId);
  return updated;
}
