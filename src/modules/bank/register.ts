/**
 * Bank repo MVP0 (spec §12 TASK-BANK), behind flag module.bank. The process
 * is draft, not operational; the outbound maker role is unresolved.
 *
 * - Instruction register: TRD_NTF and STL_INS rows. Entered from the bank_instructions
 *   mailbox until the parser is written from confirmed templates
 *   (TODO(CONFIRM-BANK-TEMPLATES)); no format is guessed.
 * - Settlement log: RECEIVED, INITIATED, COMPLETED or FAILED. The tx hash is
 *   stored for matching and masked in logs (H8) and in list views.
 * - One ticket per instruction reference (TODO(CONFIRM-BANK-PROJECT): setting
 *   bank.ticketProject; empty leaves instructions unticketed and reported).
 * Recording an ACK/NACK or a settlement here never sends anything to BANK.
 */

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/modules/settings/settings";
import { ensureTicketedWorkItem } from "@/modules/work-items/tickets";
import { redactRef } from "@/modules/daily-checks/collectors";
import { tokenAmount } from "@/lib/decimal";

export const instructionSchema = z.object({
  messageType: z.enum(["TRD_NTF", "STL_INS"]),
  reference: z.string().trim().min(1).max(100),
  instructionType: z.string().trim().toUpperCase().max(40).default(""),
  direction: z.enum(["RECEIVE", "DELIVER"]),
  asset: z.string().trim().toUpperCase().min(1).max(20),
  amount: tokenAmount({ min: "positive" }),
  valueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  receivedAt: z.string().datetime({ offset: true }),
  sourceMessageId: z.string().max(300).optional(),
  notes: z.string().max(2000).default(""),
});

export const instructionUpdateSchema = z.object({
  ackStatus: z.enum(["none", "ACK", "NACK"]).optional(),
  ackSentAt: z.string().datetime({ offset: true }).optional(),
  correctedByRef: z.string().trim().min(1).max(100).optional(),
  notes: z.string().max(2000).optional(),
}).refine((v) => Object.keys(v).length > 0, "No changes");

export const settlementLogSchema = z.object({
  reference: z.string().trim().min(1).max(100),
  status: z.enum(["RECEIVED", "INITIATED", "COMPLETED", "FAILED"]),
  txHash: z.string().trim().max(200).optional(),
  kytStatus: z.enum(["none", "fail", "escalated", "cleared"]).default("none"),
  occurredAt: z.string().datetime({ offset: true }),
  notes: z.string().max(2000).default(""),
});

export const feeBalanceSchema = z.object({
  walletRef: z.string().trim().min(1).max(100),
  asset: z.string().trim().toUpperCase().min(1).max(20),
  balance: tokenAmount({ min: "nonNegative" }),
});

export async function createInstruction(input: z.infer<typeof instructionSchema>, actorId: string | null) {
  const row = await prisma.bankInstruction.create({ data: { ...input, receivedAt: new Date(input.receivedAt), createdById: actorId } });
  const projectKey = await getSetting("bank.ticketProject");
  const item = await ensureTicketedWorkItem({
    kind: "bank_instruction",
    title: `BANK ${input.messageType} ${input.reference}: ${input.direction} ${input.amount} ${input.asset} (value ${input.valueDate})`,
    team: "Team 1",
    taskCode: "TASK-BANK",
    sourceSystem: "bank",
    sourceId: input.reference,
    clockStartedAt: new Date(input.receivedAt),
    metadata: { reference: input.reference, messageType: input.messageType },
    ticket: projectKey
      ? {
          projectKey,
          summary: `BANK ${input.messageType} ${input.reference}`,
          description: `BANK instruction ${input.reference}\nType: ${input.messageType} ${input.instructionType}\nDirection: ${input.direction}\nAsset: ${input.asset}\nAmount: ${input.amount}\nValue date: ${input.valueDate}\nReceived: ${input.receivedAt}`,
          labels: ["bank", `bank-${input.messageType.toLowerCase()}`],
        }
      : null,
  });
  return prisma.bankInstruction.update({ where: { id: row.id }, data: { workItemId: item.id } });
}

/** Register view with tx hashes masked (H8). */
export async function bankRegister() {
  const [instructions, settlements, balances] = await Promise.all([
    prisma.bankInstruction.findMany({ orderBy: { receivedAt: "desc" }, take: 200 }),
    prisma.bankSettlementLog.findMany({ orderBy: { occurredAt: "desc" }, take: 500 }),
    prisma.bankFeeBalance.findMany({ orderBy: { recordedAt: "desc" }, take: 100 }),
  ]);
  return {
    instructions,
    settlements: settlements.map((s) => ({ ...s, txHash: s.txHash ? redactRef(s.txHash) : null })),
    balances,
  };
}
