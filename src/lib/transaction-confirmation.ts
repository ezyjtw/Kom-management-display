/**
 * Transaction confirmation flow — risk-level-based notifications.
 *
 * Low risk:   Auto-logged, no notification required
 * Medium risk: Slack notification to ops channel requesting acknowledgment
 * High risk:  Slack + email to compliance requiring sign-off
 * Critical:   Slack + email + auto-escalation if not acknowledged within 15 mins
 */

import { prisma } from "@/lib/prisma";
import { sendSlackNotification } from "@/lib/integrations/slack";
import { logger } from "@/lib/logger";
import type { TransactionRiskLevel, ConfirmationStatus } from "@prisma/client";

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

/**
 * Assess risk level of a transaction based on amount, asset, and age.
 */
export function assessRiskLevel(tx: {
  amount: number;
  asset: string;
  direction: string;
  ageMinutes?: number;
  type?: string;
}): TransactionRiskLevel {
  const { amount, asset, direction, ageMinutes = 0, type } = tx;

  // Critical: very large amounts or aged collateral operations
  if (amount > 10_000_000 || (type?.includes("COLLATERAL") && ageMinutes > 60)) {
    return "critical";
  }

  // High: large transactions or old pending ones
  if (amount > 1_000_000 || ageMinutes > 60) {
    return "high";
  }

  // Medium: moderate amounts or outbound
  if (amount > 100_000 || direction === "OUT") {
    return "medium";
  }

  // Low: small inbound transactions
  return "low";
}

/**
 * Create a confirmation record and send appropriate notifications.
 */
export async function createTransactionConfirmation(
  tx: TransactionForConfirmation,
): Promise<{ id: string; riskLevel: TransactionRiskLevel; notifications: string[] }> {
  const riskLevel = tx.riskLevel ?? assessRiskLevel({
    amount: tx.amount,
    asset: tx.asset,
    direction: tx.direction,
  });

  const notifications: string[] = [];
  const opsChannel = process.env.SLACK_OPS_CHANNEL || "#ops-alerts";
  const complianceChannel = process.env.SLACK_COMPLIANCE_CHANNEL || "#compliance-alerts";
  const complianceEmails = process.env.COMPLIANCE_EMAIL_RECIPIENTS || "";

  // Calculate expiry based on risk level
  const expiryMinutes = riskLevel === "critical" ? 15 : riskLevel === "high" ? 60 : 240;
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

  // Upsert the confirmation record
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
      slackChannel: riskLevel === "high" || riskLevel === "critical" ? complianceChannel : opsChannel,
      emailSentTo: riskLevel === "high" || riskLevel === "critical" ? complianceEmails : "",
    },
  });

  // Send Slack notification for medium+ risk
  if (riskLevel !== "low") {
    const emoji = riskLevel === "critical" ? "🚨" : riskLevel === "high" ? "⚠️" : "📋";
    const urgency = riskLevel === "critical" ? "CRITICAL" : riskLevel === "high" ? "HIGH RISK" : "MEDIUM RISK";
    const channel = riskLevel === "high" || riskLevel === "critical" ? complianceChannel : opsChannel;

    const message = [
      `${emoji} *${urgency} Transaction Confirmation Required*`,
      "",
      `*Transaction:* \`${tx.transactionId}\``,
      `*Asset:* ${tx.asset}`,
      `*Amount:* ${tx.amount.toLocaleString()}`,
      `*Direction:* ${tx.direction}`,
      tx.account ? `*Account:* ${tx.account}` : "",
      "",
      `*Risk Level:* ${riskLevel.toUpperCase()}`,
      `*Expires:* ${expiresAt.toISOString()}`,
      "",
      riskLevel === "critical" || riskLevel === "high"
        ? "Please sign off on this transaction in the KOMmand Centre approvals page."
        : "Please acknowledge this transaction in the KOMmand Centre approvals page.",
    ].filter(Boolean).join("\n");

    try {
      await sendSlackNotification(channel, message);
      await prisma.transactionConfirmation.update({
        where: { id: confirmation.id },
        data: { slackNotifiedAt: new Date(), slackChannel: channel },
      });
      notifications.push("slack");
      logger.integration("slack", `Transaction confirmation sent to ${channel}`, {
        transactionId: tx.transactionId,
        riskLevel,
      });
    } catch (error) {
      logger.error("Failed to send Slack notification for transaction confirmation", {
        transactionId: tx.transactionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Send email notification for high/critical risk
  if ((riskLevel === "high" || riskLevel === "critical") && complianceEmails) {
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
      logger.integration("email", `Transaction confirmation email sent`, {
        transactionId: tx.transactionId,
        riskLevel,
        recipients: complianceEmails,
      });
    } catch (error) {
      logger.error("Failed to send email for transaction confirmation", {
        transactionId: tx.transactionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Log audit entry
  await prisma.auditLog.create({
    data: {
      action: "transaction_confirmation_created",
      entityType: "transaction_confirmation",
      entityId: confirmation.id,
      userId: "system",
      details: JSON.stringify({ transactionId: tx.transactionId, riskLevel, notifications }),
    },
  });

  logger.info("Transaction confirmation created", {
    confirmationId: confirmation.id,
    transactionId: tx.transactionId,
    riskLevel,
    notifications,
  });

  return { id: confirmation.id, riskLevel, notifications };
}

/**
 * Acknowledge a transaction confirmation (for medium risk).
 */
export async function acknowledgeConfirmation(
  confirmationId: string,
  userId: string,
): Promise<void> {
  await prisma.transactionConfirmation.update({
    where: { id: confirmationId },
    data: {
      status: "acknowledged",
      acknowledgedById: userId,
      acknowledgedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "transaction_confirmation_acknowledged",
      entityType: "transaction_confirmation",
      entityId: confirmationId,
      userId,
    },
  });
}

/**
 * Sign off on a transaction confirmation (for high/critical risk).
 */
export async function signOffConfirmation(
  confirmationId: string,
  userId: string,
): Promise<void> {
  await prisma.transactionConfirmation.update({
    where: { id: confirmationId },
    data: {
      status: "signed_off",
      signedOffById: userId,
      signedOffAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "transaction_confirmation_signed_off",
      entityType: "transaction_confirmation",
      entityId: confirmationId,
      userId,
    },
  });
}

/**
 * Escalate a transaction confirmation.
 */
export async function escalateConfirmation(
  confirmationId: string,
  userId: string,
  reason: string,
): Promise<void> {
  await prisma.transactionConfirmation.update({
    where: { id: confirmationId },
    data: {
      status: "escalated",
      escalatedById: userId,
      escalatedAt: new Date(),
      escalationReason: reason,
    },
  });

  // Notify compliance channel
  const confirmation = await prisma.transactionConfirmation.findUnique({
    where: { id: confirmationId },
  });

  if (confirmation) {
    const complianceChannel = process.env.SLACK_COMPLIANCE_CHANNEL || "#compliance-alerts";
    await sendSlackNotification(
      complianceChannel,
      `🚨 *Transaction Escalated*\n\nTransaction \`${confirmation.transactionId}\` has been escalated.\n*Reason:* ${reason}\n*Asset:* ${confirmation.asset}\n*Amount:* ${confirmation.amount.toLocaleString()}`
    ).catch(() => {});
  }

  await prisma.auditLog.create({
    data: {
      action: "transaction_confirmation_escalated",
      entityType: "transaction_confirmation",
      entityId: confirmationId,
      userId,
      details: JSON.stringify({ reason }),
    },
  });
}

/**
 * Check for expired confirmations and auto-escalate.
 */
export async function checkExpiredConfirmations(): Promise<number> {
  const expired = await prisma.transactionConfirmation.findMany({
    where: {
      status: "pending",
      expiresAt: { lt: new Date() },
    },
  });

  for (const conf of expired) {
    await prisma.transactionConfirmation.update({
      where: { id: conf.id },
      data: { status: "expired" },
    });

    // Auto-escalate critical transactions
    if (conf.riskLevel === "critical" || conf.riskLevel === "high") {
      await escalateConfirmation(conf.id, "system", "Auto-escalated: confirmation expired without acknowledgment");
    }

    logger.warn("Transaction confirmation expired", {
      confirmationId: conf.id,
      transactionId: conf.transactionId,
      riskLevel: conf.riskLevel,
    });
  }

  return expired.length;
}
