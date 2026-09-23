/**
 * Outbound email notifications via SMTP. Inbound mail is ingested through
 * Microsoft Graph (src/modules/integrations/graph/sync.ts); IMAP was removed.
 */

import { env } from "@/lib/env";

/**
 * Send an email notification via SMTP.
 */
export async function sendEmailNotification(
  to: string,
  subject: string,
  body: string
) {
  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASSWORD");

  if (!host || !user || !pass) return;

  const nodemailer = await import("nodemailer");

  const transporter = nodemailer.createTransport({
    host,
    port: parseInt(env("SMTP_PORT") || "587", 10),
    secure: env("SMTP_SECURE") === "true",
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: env("SMTP_FROM") || user,
    to,
    subject,
    text: body,
  });
}
