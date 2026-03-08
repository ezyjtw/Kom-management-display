/**
 * Email notification for high/critical risk transaction confirmations.
 * Sends a structured HTML email with transaction details.
 */

import nodemailer from "nodemailer";
import { logger } from "@/lib/logger";

interface ConfirmationEmailData {
  to: string[];
  transactionId: string;
  asset: string;
  amount: number;
  direction: string;
  riskLevel: string;
  account: string;
  expiresAt: Date;
}

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "localhost",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        }
      : undefined,
  });
}

export async function sendConfirmationEmail(data: ConfirmationEmailData): Promise<void> {
  const transporter = getTransporter();
  const appUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const riskBadge = data.riskLevel === "critical"
    ? '<span style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:4px;font-weight:bold;">CRITICAL</span>'
    : '<span style="background:#f97316;color:#fff;padding:2px 8px;border-radius:4px;font-weight:bold;">HIGH RISK</span>';

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#1e293b;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;">KOMmand Centre — Transaction Confirmation Required</h2>
      </div>
      <div style="border:1px solid #e2e8f0;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
        <p>A ${data.riskLevel} risk transaction requires your sign-off.</p>

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
            <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${data.amount.toLocaleString()}</td>
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
          <a href="${appUrl}/approvals" style="background:#2563eb;color:#fff;padding:12px 32px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">
            Review & Sign Off
          </a>
        </div>

        <p style="color:#64748b;font-size:13px;">
          This confirmation will auto-escalate if not acknowledged by ${data.expiresAt.toISOString()}.
        </p>
      </div>
    </div>
  `;

  const subject = `[${data.riskLevel.toUpperCase()}] Transaction Confirmation: ${data.asset} ${data.amount.toLocaleString()} ${data.direction}`;

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || "kommand-centre@komainu.com",
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
