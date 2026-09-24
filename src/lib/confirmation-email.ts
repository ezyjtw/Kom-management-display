/**
 * Email notification for high/critical risk transaction confirmations.
 * Sends a structured HTML email with transaction details.
 */

import nodemailer from "nodemailer";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import { formatAmount, type DecimalValue } from "@/lib/decimal";

interface ConfirmationEmailData {
  to: string[];
  transactionId: string;
  asset: string;
  amount: DecimalValue;
  direction: string;
  riskLevel: string;
  account: string;
  expiresAt: Date;
}

function getTransporter() {
  return nodemailer.createTransport({
    host: env("SMTP_HOST") || "localhost",
    port: parseInt(env("SMTP_PORT") || "587"),
    secure: env("SMTP_SECURE") === "true",
    auth: env("SMTP_USER")
      ? {
          user: env("SMTP_USER"),
          pass: env("SMTP_PASSWORD"),
        }
      : undefined,
  });
}

export async function sendConfirmationEmail(data: ConfirmationEmailData): Promise<void> {
  const transporter = getTransporter();
  const appUrl = env("NEXTAUTH_URL") || "http://localhost:3000";
  const riskBadge = data.riskLevel === "critical"
    ? '<span style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:4px;font-weight:bold;">CRITICAL</span>'
    : '<span style="background:#f97316;color:#fff;padding:2px 8px;border-radius:4px;font-weight:bold;">HIGH RISK</span>';

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#1e293b;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;">KOMmand Centre — Transaction Confirmation Required</h2>
      </div>
      <div style="border:1px solid #e2e8f0;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
        <p>A ${data.riskLevel} risk transaction flagged in GX is awaiting action in GX. KOMmand Centre does not approve transactions.</p>

        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr>
            <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-weight:bold;width:140px;">Risk Level</td>
            <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${riskBadge}</td>
          </tr>
          <tr>
            <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-weight:bold;">Transaction ID</td>
            <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-family:monospace;">${data.transactionId}</td>
          </tr>
          <tr>
            <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-weight:bold;">Asset</td>
            <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${data.asset}</td>
          </tr>
          <tr>
            <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-weight:bold;">Amount</td>
            <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${formatAmount(data.amount, 18)}</td>
          </tr>
          <tr>
            <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-weight:bold;">Direction</td>
            <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${data.direction}</td>
          </tr>
          <tr>
            <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-weight:bold;">Account</td>
            <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${data.account || "—"}</td>
          </tr>
          <tr>
            <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-weight:bold;">Confirmation Deadline</td>
            <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${data.expiresAt.toISOString()}</td>
          </tr>
        </table>

        <div style="text-align:center;margin:24px 0;">
          <a href="${appUrl}/transaction-confirmations" style="background:#2563eb;color:#fff;padding:12px 32px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">
            View in KOMmand Centre
          </a>
        </div>

        <p style="color:#64748b;font-size:13px;">
          This item will auto-escalate if nobody takes ownership by ${data.expiresAt.toISOString()}.
        </p>
      </div>
    </div>
  `;

  const subject = `[${data.riskLevel.toUpperCase()}] Awaiting action in GX: ${data.asset} ${formatAmount(data.amount, 18)} ${data.direction}`;

  try {
    await transporter.sendMail({
      from: env("SMTP_FROM") || "kommand-centre@company.com",
      to: data.to.join(", "),
      subject,
      html,
    });
    logger.info("Confirmation email sent", {
      transactionId: data.transactionId,
      recipients: data.to,
    });
  } catch (error) {
    logger.error("Failed to send confirmation email", {
      transactionId: data.transactionId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
