/**
 * Outbound email notifications via SMTP. Inbound mail is ingested through
 * Microsoft Graph (src/modules/integrations/graph/sync.ts); IMAP was removed.
 */

import { env } from "@/lib/env";

/**
 * Send an email notification via SMTP. Returns true only when the SMTP server
 * accepted the message; false when SMTP is not configured. Throws on send errors.
 */
export async function sendEmailNotification(
  to: string,
  subject: string,
  body: string
): Promise<boolean> {
  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASSWORD");

  if (!host || !user || !pass) return false;

  const nodemailer = await import("nodemailer");

  const transporter = nodemailer.createTransport({
    host,
    port: parseInt(env("SMTP_PORT") || "587", 10),
    secure: env("SMTP_SECURE") === "true",
    auth: { user, pass },
  });

  const info = await transporter.sendMail({
    from: env("SMTP_FROM") || user,
    to,
    subject,
    text: body,
  });
  return Array.isArray(info.accepted) && info.accepted.length > 0;
}
