/**
 * Read-only tracker of Platform risk-flagged transactions awaiting human action in Platform.
 *
 * KOMmand Centre never approves, signs or confirms transactions (H1). Risk levels
 * come from Platform only (H5); without one the level is "unknown". Humans may only
 * take ownership, add a note or link a ticket. Closure is automatic once the
 * custody API shows the item is no longer PENDING.
 */

import { prisma } from "@/lib/prisma";
import { sendSlackNotification } from "@/lib/integrations/slack";
import {
  fetchRequest,
  fetchTransaction,
  isCustodyConfigured,
} from "@/lib/integrations/custody-api/client";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import type { TransactionRiskLevel } from "@prisma/client";
import { formatAmount, type DecimalValue } from "@/lib/decimal";

export interface TransactionForConfirmation {
  transactionId: string;
  requestId?: string;
  asset: string;
  amount: DecimalValue;
  direction: string;
  account?: string;
  workspace?: string;
  riskLevel?: TransactionRiskLevel;
}

const OPEN_STATUSES = ["pending", "owned", "escalated"] as const;

function isElevated(riskLevel: TransactionRiskLevel): boolean {
  return riskLevel === "high" || riskLevel === "critical";
}

export async function createTransactionConfirmation(
  tx: TransactionForConfirmation,
): Promise<{ id: string; riskLevel: TransactionRiskLevel; notifications: string[] }> {
  const riskLevel: TransactionRiskLevel = tx.riskLevel ?? "unknown";

  const notifications: string[] = [];
  const opsChannel = env("SLACK_OPS_CHANNEL") || "#ops-alerts";
  const complianceChannel = env("SLACK_COMPLIANCE_CHANNEL") || "#compliance-alerts";
  const complianceEmails = env("COMPLIANCE_EMAIL_RECIPIENTS") || "";
  const channel = isElevated(riskLevel) ? complianceChannel : opsChannel;

  const expiryMinutes = riskLevel === "critical" ? 15 : riskLevel === "high" ? 60 : 240;
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

  const confirmation = await prisma.transactionConfirmation.upsert({
    where: { transactionId: tx.transactionId },
    update: {
      riskLevel,
      amount: tx.amount,
      asset: tx.asset,
      direction: tx.direction,
      account: tx.account || "",
      workspace: tx.workspace || "",
      expiresAt,
    },
    create: {
      transactionId: tx.transactionId,
      requestId: tx.requestId,
      riskLevel,
      asset: tx.asset,
      amount: tx.amount,
      direction: tx.direction,
      account: tx.account || "",
      workspace: tx.workspace || "",
      expiresAt,
      slackChannel: channel,
      emailSentTo: isElevated(riskLevel) ? complianceEmails : "",
    },
  });

  if (riskLevel !== "low") {
    const urgency = riskLevel === "unknown" ? "RISK UNKNOWN" : `${riskLevel.toUpperCase()} RISK`;
    const message = [
      `*${urgency}: transaction awaiting action in Platform*`,
      "",
      `*Transaction:* \`${tx.transactionId}\``,
      `*Asset:* ${tx.asset}`,
      `*Amount:* ${formatAmount(tx.amount, 18)}`,
      `*Direction:* ${tx.direction}`,
      tx.account ? `*Account:* ${tx.account}` : "",
      "",
      "Action it in Platform. Take ownership in KOMmand Centre so the team knows who is handling it.",
    ].filter(Boolean).join("\n");

    try {
      await sendSlackNotification(channel, message);
      await prisma.transactionConfirmation.update({
        where: { id: confirmation.id },
        data: { slackNotifiedAt: new Date(), slackChannel: channel },
      });
      notifications.push("slack");
    } catch (error) {
      logger.error("Failed to send Slack notification for transaction confirmation", {
        transactionId: tx.transactionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (isElevated(riskLevel) && complianceEmails) {
    try {
      const { sendConfirmationEmail } = await import("@/lib/confirmation-email");
      await sendConfirmationEmail({
        to: complianceEmails.split(",").map((e) => e.trim()),
        transactionId: tx.transactionId,
        asset: tx.asset,
        amount: tx.amount,
        direction: tx.direction,
        riskLevel,
        account: tx.account || "",
        expiresAt,
      });
      await prisma.transactionConfirmation.update({
        where: { id: confirmation.id },
        data: { emailNotifiedAt: new Date() },
      });
      notifications.push("email");
    } catch (error) {
      logger.error("Failed to send email for transaction confirmation", {
        transactionId: tx.transactionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      action: "transaction_confirmation_created",
      entityType: "transaction_confirmation",
      entityId: confirmation.id,
      userId: "system",
      details: JSON.stringify({ transactionId: tx.transactionId, riskLevel, notifications }),
    },
  });

  return { id: confirmation.id, riskLevel, notifications };
}

/** "I am handling this in Platform." */
export async function takeOwnership(confirmationId: string, userId: string): Promise<void> {
  await prisma.transactionConfirmation.update({
    where: { id: confirmationId },
    data: { status: "owned", ownedById: userId, ownedAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      action: "transaction_confirmation_owned",
      entityType: "transaction_confirmation",
      entityId: confirmationId,
      userId,
    },
  });
}

export async function addNote(confirmationId: string, userId: string, note: string): Promise<void> {
  const existing = await prisma.transactionConfirmation.findUniqueOrThrow({
    where: { id: confirmationId },
    select: { notes: true },
  });
  const entry = `[${new Date().toISOString()}] ${note}`;

  await prisma.transactionConfirmation.update({
    where: { id: confirmationId },
    data: { notes: existing.notes ? `${existing.notes}\n${entry}` : entry },
  });

  await prisma.auditLog.create({
    data: {
      action: "transaction_confirmation_note_added",
      entityType: "transaction_confirmation",
      entityId: confirmationId,
      userId,
      details: JSON.stringify({ note }),
    },
  });
}

export async function linkTicket(confirmationId: string, userId: string, ticketRef: string): Promise<void> {
  await prisma.transactionConfirmation.update({
    where: { id: confirmationId },
    data: { ticketRef },
  });

  await prisma.auditLog.create({
    data: {
      action: "transaction_confirmation_ticket_linked",
      entityType: "transaction_confirmation",
      entityId: confirmationId,
      userId,
      details: JSON.stringify({ ticketRef }),
    },
  });
}

/** Direct custody lookups per run for confirmations the pollers have not seen. */
export const MAX_DIRECT_LOOKUPS = 20;

/**
 * Close open confirmations whose request/transaction is no longer PENDING in
 * the custody API. Returns the number closed.
 *
 * The request and transaction pollers already read every PENDING record every
 * 1-2 minutes into SourceRecord, and mark records that leave the pending set as
 * `no_longer_listed`. So the status is read from there, in one query, instead
 * of one API call per open confirmation (load review, Phase 12n). Only
 * confirmations the pollers have never seen are looked up directly, at most
 * MAX_DIRECT_LOOKUPS per run. If polling stops, nothing is closed (safe side).
 */
export async function syncConfirmationsWithSource(): Promise<number> {
  if (!isCustodyConfigured()) return 0;

  const open = await prisma.transactionConfirmation.findMany({
    where: { status: { in: [...OPEN_STATUSES] } },
    select: { id: true, transactionId: true, requestId: true },
    take: 200,
  });
  if (open.length === 0) return 0;

  const records = await prisma.sourceRecord.findMany({
    where: {
      source: "custody_api",
      OR: [
        { kind: "request", externalId: { in: open.flatMap((c) => (c.requestId ? [c.requestId] : [])) } },
        { kind: "transaction", externalId: { in: open.filter((c) => !c.requestId).map((c) => c.transactionId) } },
      ],
    },
    select: { kind: true, externalId: true, status: true, mappedStatus: true },
  });
  const seen = new Map(records.map((r) => [`${r.kind}:${r.externalId}`, r]));

  let closed = 0;
  let direct = 0;
  for (const conf of open) {
    try {
      const rec = conf.requestId ? seen.get(`request:${conf.requestId}`) : seen.get(`transaction:${conf.transactionId}`);
      let sourceStatus: string | null;
      if (rec) {
        sourceStatus = rec.mappedStatus === "no_longer_listed" ? "no_longer_listed" : rec.status;
      } else {
        if (direct >= MAX_DIRECT_LOOKUPS) continue;
        direct++;
        sourceStatus = conf.requestId
          ? (await fetchRequest(conf.requestId)).status
          : (await fetchTransaction(conf.transactionId)).status;
      }
      if (!sourceStatus || sourceStatus === "PENDING") continue;

      await prisma.transactionConfirmation.update({
        where: { id: conf.id },
        data: { status: "closed_in_source", closedInSourceAt: new Date() },
      });
      await prisma.auditLog.create({
        data: {
          action: "transaction_confirmation_closed_in_source",
          entityType: "transaction_confirmation",
          entityId: conf.id,
          userId: "system",
          details: JSON.stringify({ sourceStatus }),
        },
      });
      closed++;
    } catch (error) {
      logger.warn("Could not check confirmation against custody API", {
        confirmationId: conf.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return closed;
}

/** System-only escalation, used when an elevated item expires unowned. */
async function escalateConfirmation(confirmationId: string, reason: string): Promise<void> {
  const confirmation = await prisma.transactionConfirmation.update({
    where: { id: confirmationId },
    data: {
      status: "escalated",
      escalatedById: "system",
      escalatedAt: new Date(),
      escalationReason: reason,
    },
  });

  const complianceChannel = env("SLACK_COMPLIANCE_CHANNEL") || "#compliance-alerts";
  await sendSlackNotification(
    complianceChannel,
    `*Transaction awaiting action in Platform has been escalated*\n\nTransaction \`${confirmation.transactionId}\`\n*Reason:* ${reason}\n*Asset:* ${confirmation.asset}\n*Amount:* ${formatAmount(confirmation.amount, 18)}`,
  ).catch(() => {});

  await prisma.auditLog.create({
    data: {
      action: "transaction_confirmation_escalated",
      entityType: "transaction_confirmation",
      entityId: confirmationId,
      userId: "system",
      details: JSON.stringify({ reason }),
    },
  });
}

/** Expire unowned items past their deadline; escalate elevated ones. */
export async function checkExpiredConfirmations(): Promise<number> {
  const expired = await prisma.transactionConfirmation.findMany({
    where: { status: "pending", expiresAt: { lt: new Date() } },
  });

  for (const conf of expired) {
    if (isElevated(conf.riskLevel)) {
      await escalateConfirmation(conf.id, "Auto-escalated: nobody took ownership before expiry");
    } else {
      await prisma.transactionConfirmation.update({
        where: { id: conf.id },
        data: { status: "expired" },
      });
    }
    logger.warn("Transaction confirmation expired", {
      confirmationId: conf.id,
      riskLevel: conf.riskLevel,
    });
  }

  return expired.length;
}
