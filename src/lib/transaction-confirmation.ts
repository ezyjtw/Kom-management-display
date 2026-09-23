/**
 * Read-only tracker of GX risk-flagged transactions awaiting human action in GX.
 *
 * KOMmand Centre never approves, signs or confirms transactions (H1). Risk levels
 * come from GX only (H5); without one the level is "unknown". Humans may only
 * take ownership, add a note or link a ticket. Closure is automatic once the
 * Komainu API shows the item is no longer PENDING.
 */

import { prisma } from "@/lib/prisma";
import { sendSlackNotification } from "@/lib/integrations/slack";
import {
  fetchRequest,
  fetchTransaction,
  isKomainuConfigured,
} from "@/lib/integrations/komainu-api/client";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import type { TransactionRiskLevel } from "@prisma/client";

export interface TransactionForConfirmation {
  transactionId: string;
  requestId?: string;
  asset: string;
  amount: number;
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
      `*${urgency}: transaction awaiting action in GX*`,
      "",
      `*Transaction:* \`${tx.transactionId}\``,
      `*Asset:* ${tx.asset}`,
      `*Amount:* ${tx.amount.toLocaleString()}`,
      `*Direction:* ${tx.direction}`,
      tx.account ? `*Account:* ${tx.account}` : "",
      "",
      "Action it in GX. Take ownership in KOMmand Centre so the team knows who is handling it.",
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

/** "I am handling this in GX." */
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

/**
 * Close open confirmations whose request/transaction is no longer PENDING in
 * the Komainu API. Returns the number closed.
 */
export async function syncConfirmationsWithSource(): Promise<number> {
  if (!isKomainuConfigured()) return 0;

  const open = await prisma.transactionConfirmation.findMany({
    where: { status: { in: [...OPEN_STATUSES] } },
    select: { id: true, transactionId: true, requestId: true },
    take: 200,
  });

  let closed = 0;
  for (const conf of open) {
    try {
      const sourceStatus = conf.requestId
        ? (await fetchRequest(conf.requestId)).status
        : (await fetchTransaction(conf.transactionId)).status;
      if (sourceStatus === "PENDING") continue;

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
      logger.warn("Could not check confirmation against Komainu API", {
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
    `*Transaction awaiting action in GX has been escalated*\n\nTransaction \`${confirmation.transactionId}\`\n*Reason:* ${reason}\n*Asset:* ${confirmation.asset}\n*Amount:* ${confirmation.amount.toLocaleString()}`,
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
