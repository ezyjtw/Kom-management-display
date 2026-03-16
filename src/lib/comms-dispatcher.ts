/**
 * Comms Dispatcher — Stream 3
 *
 * Dispatches approved client communications via Slack or email.
 * Implements retry logic, delivery tracking, and audit logging.
 * Never auto-sends — only dispatches after explicit human approval.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { createAuditEntry } from "@/lib/api/audit";
import { slackBreaker, emailBreaker } from "@/lib/circuit-breaker";

interface Recipient {
  channel: "slack" | "email";
  address: string; // Slack channel ID or email address
}

interface DispatchResult {
  draftId: string;
  success: boolean;
  deliveredTo: Array<{
    channel: string;
    address: string;
    status: "delivered" | "failed";
    error?: string;
  }>;
  failedCount: number;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

/**
 * Dispatch approved client comms to recipients.
 *
 * - Sends via Slack or email per recipient
 * - Retry: max 3 attempts, 5s delay
 * - Records delivery status per recipient
 * - Updates ClientCommsDraft status
 * - Updates ClientImpactRecord.clientNotifiedAt
 * - Updates Incident counts
 * - Writes AuditLog
 * - Never silently drops failures
 */
export async function dispatchClientComms(
  draftId: string,
  approvedByEmployeeId: string,
  finalMessage: string,
  recipients: Recipient[],
): Promise<DispatchResult> {
  const draft = await prisma.clientCommsDraft.findUnique({
    where: { id: draftId },
  });

  if (!draft) {
    throw new Error(`Draft ${draftId} not found`);
  }

  // Update draft with approval info
  await prisma.clientCommsDraft.update({
    where: { id: draftId },
    data: {
      status: "approved",
      finalMessage,
      approvedByEmployeeId,
      approvedAt: new Date(),
    },
  });

  const deliveryResults: DispatchResult["deliveredTo"] = [];
  let failedCount = 0;

  for (const recipient of recipients) {
    let delivered = false;
    let lastError = "";

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (recipient.channel === "slack") {
          await sendViaSlack(recipient.address, finalMessage);
        } else {
          await sendViaEmail(recipient.address, draft.clientName, finalMessage);
        }
        delivered = true;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        logger.warn("dispatchClientComms: delivery attempt failed", {
          draftId,
          recipient: recipient.address,
          channel: recipient.channel,
          attempt,
          error: lastError,
        });

        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS);
        }
      }
    }

    if (delivered) {
      deliveryResults.push({
        channel: recipient.channel,
        address: recipient.address,
        status: "delivered",
      });
    } else {
      failedCount++;
      deliveryResults.push({
        channel: recipient.channel,
        address: recipient.address,
        status: "failed",
        error: lastError,
      });
      logger.error("dispatchClientComms: delivery failed after all retries", {
        draftId,
        recipient: recipient.address,
        channel: recipient.channel,
        error: lastError,
      });
    }
  }

  // Determine overall status
  const overallStatus = failedCount === recipients.length ? "failed" : "sent";
  const deliveryStatus = failedCount === 0 ? "delivered" : failedCount < recipients.length ? "delivered" : "failed";
  const deliveryError = deliveryResults
    .filter((r) => r.status === "failed")
    .map((r) => `${r.channel}:${r.address}: ${r.error}`)
    .join("; ");

  // Update draft
  await prisma.clientCommsDraft.update({
    where: { id: draftId },
    data: {
      status: overallStatus,
      sentAt: overallStatus === "sent" ? new Date() : undefined,
      deliveryStatus,
      deliveryError: deliveryError || "",
    },
  });

  // Update ClientImpactRecord.clientNotifiedAt
  if (overallStatus === "sent") {
    const now = new Date();
    await prisma.clientImpactRecord.update({
      where: { id: draft.clientImpactRecordId },
      data: {
        clientNotifiedAt: now,
        notifiedByEmployeeId: approvedByEmployeeId,
      },
    });

    // Update Incident counts
    const notifiedCount = await prisma.clientImpactRecord.count({
      where: {
        incidentId: draft.incidentId,
        clientNotifiedAt: { not: null },
      },
    });

    const incidentUpdate: Record<string, unknown> = {
      clientNotifiedCount: notifiedCount,
    };

    // Set firstClientNotifiedAt if this is the first
    const incident = await prisma.incident.findUnique({
      where: { id: draft.incidentId },
      select: { firstClientNotifiedAt: true },
    });

    if (incident && !incident.firstClientNotifiedAt) {
      incidentUpdate.firstClientNotifiedAt = now;
    }

    await prisma.incident.update({
      where: { id: draft.incidentId },
      data: incidentUpdate,
    });
  }

  // Write audit log — always, even on failure
  await createAuditEntry({
    action: overallStatus === "sent" ? "client_comms_sent" : "client_comms_failed",
    entityType: "client_comms_draft",
    entityId: draftId,
    userId: approvedByEmployeeId,
    summary: `Client comms ${overallStatus} to ${draft.clientName} for incident ${draft.incidentId}. ${deliveryResults.length - failedCount}/${deliveryResults.length} recipients reached.`,
    metadata: {
      incidentId: draft.incidentId,
      clientName: draft.clientName,
      recipientCount: recipients.length,
      failedCount,
      channels: [...new Set(recipients.map((r) => r.channel))],
    },
  });

  return {
    draftId,
    success: failedCount === 0,
    deliveredTo: deliveryResults,
    failedCount,
  };
}

// ─── Channel Implementations ───

async function sendViaSlack(channelId: string, message: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN not configured");
  }

  await slackBreaker().execute(async () => {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        channel: channelId,
        text: message,
      }),
    });

    if (!res.ok) {
      throw new Error(`Slack API HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`);
    }
  });
}

async function sendViaEmail(
  toAddress: string,
  clientName: string,
  body: string,
): Promise<void> {
  // Use SMTP or email API if configured
  const smtpHost = process.env.SMTP_HOST;
  if (!smtpHost) {
    throw new Error("SMTP_HOST not configured");
  }

  await emailBreaker().execute(async () => {
    // Nodemailer-style send (or API-based)
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || "ops@company.com",
      to: toAddress,
      subject: `Service Update — ${clientName}`,
      text: body,
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
