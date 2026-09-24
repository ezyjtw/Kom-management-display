/**
 * BANK rules (spec §11.2 ALR-BANK-01..08) over the BANK instruction register and
 * settlement log (spec §12 TASK-BANK). Nothing is evaluated while module.bank
 * is off. Alerts attach to the instruction's WorkItem ("same ticket").
 */

import { isFeatureEnabled } from "@/lib/feature-flags";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { londonInstant, londonParts } from "@/modules/alerting/calendar";
import { commentInternal } from "@/modules/work-items/ticket-writeback";
import { numParam, type AlertCandidate, type EvaluatorContext } from "@/modules/alerting/types";
import { dec } from "@/lib/decimal";

const on = () => isFeatureEnabled("module.bank");
const hhmm = (v: unknown, fallback: string) => {
  const [h, m] = String(typeof v === "string" ? v : fallback).split(":").map(Number);
  return h * 60 + (m || 0);
};

type Instruction = Awaited<ReturnType<typeof prisma.bankInstruction.findMany>>[number];
function linked(i: Instruction): Pick<AlertCandidate, "workItemId" | "workItemSeed"> {
  return i.workItemId ? { workItemId: i.workItemId } : { workItemSeed: { kind: "bank_instruction", team: "Team 1", taskCode: "TASK-BANK" } };
}

/** ALR-BANK-01: instruction received, not yet ACKed or NACKed. */
export async function evaluateInstructionReceived(_ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  if (!(await on())) return [];
  const rows = await prisma.bankInstruction.findMany({ where: { ackStatus: "none" } });
  return rows.map((i) => ({
    dedupeKey: i.sourceMessageId ?? i.reference,
    severity: "medium" as const,
    title: `BANK instruction received: ${i.messageType} ${i.reference}`,
    detail: `${i.direction} ${i.amount} ${i.asset}, value date ${i.valueDate}, received ${i.receivedAt.toISOString()}. Record the ACK or NACK once sent.`,
    ...linked(i),
  }));
}

/** ALR-BANK-02: no ACK/NACK within the confirmed number of minutes (CONFIRM-BANK-ACK-MINS). */
export async function evaluateNotAcknowledged(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  if (!(await on())) return [];
  const mins = numParam(ctx.params, "ackMins", Infinity);
  const rows = await prisma.bankInstruction.findMany({ where: { ackStatus: "none", receivedAt: { lt: new Date(ctx.now.getTime() - mins * 60_000) } } });
  return rows.map((i) => ({
    dedupeKey: i.reference,
    severity: "high" as const,
    title: `BANK instruction not acknowledged: ${i.reference}`,
    detail: `No MSG_STS ACK or NACK recorded ${Math.round((ctx.now.getTime() - i.receivedAt.getTime()) / 60_000)} minutes after receipt (limit ${mins}).`,
    ...linked(i),
  }));
}

/** ALR-BANK-03: instruction received after the cut-off (London). Informational; never auto-resolves. */
export async function evaluateAfterCutoff(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  if (!(await on())) return [];
  const cutoff = hhmm(ctx.params.cutoffLocal, "15:00");
  const since = new Date(ctx.now.getTime() - 3 * 86_400_000);
  const rows = (await prisma.bankInstruction.findMany({ where: { receivedAt: { gte: since } } }))
    .filter((i) => i.receivedAt >= londonInstant(londonParts(i.receivedAt).date, cutoff));
  return rows.map((i) => ({
    dedupeKey: i.reference,
    severity: "medium" as const,
    title: `BANK instruction after cut-off: ${i.reference}`,
    detail: `Received ${i.receivedAt.toISOString()}, after ${String(ctx.params.cutoffLocal ?? "15:00")} UK time.`,
    ...linked(i),
  }));
}

export async function onAfterCutoff(_alertId: string, c: AlertCandidate): Promise<void> {
  if (!c.workItemId) return;
  try {
    await commentInternal(c.workItemId, "Received after the 15:00 UK cut-off: this instruction rolls to the next day.");
  } catch (error) {
    logger.warn("Could not add the cut-off comment", { error: error instanceof Error ? error.message : String(error) });
  }
}

/** ALR-BANK-04: NACK sent; clears when a corrected instruction is recorded. */
export async function evaluateNackSent(_ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  if (!(await on())) return [];
  const rows = await prisma.bankInstruction.findMany({ where: { ackStatus: "NACK", correctedByRef: null } });
  return rows.map((i) => ({
    dedupeKey: i.reference,
    severity: "medium" as const,
    title: `BANK NACK sent: ${i.reference}`,
    detail: `A NACK was sent${i.ackSentAt ? ` at ${i.ackSentAt.toISOString()}` : ""}. Waiting for a corrected instruction.`,
    ...linked(i),
  }));
}

async function instructionsByRef(refs: string[]) {
  return new Map((await prisma.bankInstruction.findMany({ where: { reference: { in: refs } } })).map((i) => [i.reference, i]));
}

/** ALR-BANK-05: settlement FAILED in the log. Never auto-resolves (needs write-up); opens an INC draft. */
export async function evaluateSettlementFailed(_ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  if (!(await on())) return [];
  const failed = await prisma.bankSettlementLog.findMany({ where: { status: "FAILED" } });
  const byRef = await instructionsByRef(failed.map((f) => f.reference));
  return [...new Set(failed.map((f) => f.reference))].map((ref) => {
    const i = byRef.get(ref);
    return {
      dedupeKey: ref,
      severity: "critical" as const,
      title: `BANK settlement failed: ${ref}`,
      detail: `The settlement log records FAILED for instruction ${ref}.`,
      ...(i ? linked(i) : { workItemSeed: { kind: "bank_instruction" as const, team: "Team 1", taskCode: "TASK-BANK" } }),
    };
  });
}

/** ALR-BANK-06: OPEN or MARGIN RECEIVE instruction with value date today and no inbound recorded by the cut-off. */
export async function evaluateDepositNotReceived(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  if (!(await on())) return [];
  const today = londonParts(ctx.now).date;
  const cutoff = hhmm(ctx.params.valueDateCutoffLocal, "23:59");
  if (ctx.now < londonInstant(today, cutoff)) return [];
  const due = await prisma.bankInstruction.findMany({ where: { valueDate: today, instructionType: { in: ["OPEN", "MARGIN_RECEIVE", "MARGIN RECEIVE"] }, direction: "RECEIVE" } });
  if (!due.length) return [];
  const inbound = new Set((await prisma.bankSettlementLog.findMany({ where: { reference: { in: due.map((d) => d.reference) }, status: { in: ["RECEIVED", "COMPLETED"] } } })).map((l) => l.reference));
  return due.filter((i) => !inbound.has(i.reference)).map((i) => ({
    dedupeKey: i.reference,
    severity: "high" as const,
    title: `BANK deposit not received by value date: ${i.reference}`,
    detail: `${i.amount} ${i.asset} due today (${today}); no inbound recorded by the cut-off.`,
    ...linked(i),
  }));
}

/** ALR-BANK-07: inbound with a KYT fail or escalation; clears when the Compliance outcome is recorded. */
export async function evaluateInboundKytLock(_ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  if (!(await on())) return [];
  const rows = await prisma.bankSettlementLog.findMany({ where: { kytStatus: { in: ["fail", "escalated"] } } });
  const byRef = await instructionsByRef(rows.map((r) => r.reference));
  return rows.map((r) => {
    const i = byRef.get(r.reference);
    return {
      dedupeKey: r.id,
      severity: "critical" as const,
      title: `BANK inbound KYT lock: ${r.reference}`,
      detail: `KYT ${r.kytStatus} on an inbound for ${r.reference}. BANK inbound collateral is not risk-scored; Compliance outcome required.`,
      ...(i ? linked(i) : { workItemSeed: { kind: "bank_instruction" as const, team: "Team 1", taskCode: "TASK-BANK" } }),
    };
  });
}

/** ALR-BANK-08: latest fee-reserve balance below the confirmed threshold for its asset (CONFIRM-FEE-THRESHOLDS). */
export async function evaluateFeeBufferLow(ctx: EvaluatorContext): Promise<AlertCandidate[]> {
  if (!(await on())) return [];
  const thresholds = (ctx.params.thresholds && typeof ctx.params.thresholds === "object" ? ctx.params.thresholds : {}) as Record<string, number | string>;
  const rows = await prisma.bankFeeBalance.findMany({ orderBy: { recordedAt: "desc" }, take: 1000 });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.walletRef)) latest.set(r.walletRef, r);
  return [...latest.values()]
    .filter((b) => (typeof thresholds[b.asset] === "number" || typeof thresholds[b.asset] === "string") && dec(b.balance).lt(dec(thresholds[b.asset])))
    .map((b) => ({
      dedupeKey: b.walletRef,
      severity: "high" as const,
      title: `BANK fee buffer low: ${b.asset}`,
      detail: `Fee reserve ${b.walletRef} holds ${dec(b.balance).toFixed()} ${b.asset} (threshold ${thresholds[b.asset]}), recorded ${b.recordedAt.toISOString()}.`,
      workItemSeed: { kind: "bank_instruction" as const, team: "Team 1", taskCode: "TASK-BANK" },
    }));
}
