import { prisma } from "@/lib/prisma";
import { computeTtoDeadline } from "@/lib/sla";
import type { ThreadPriority } from "@/types";

/**
 * Email configuration interface for IMAP connections.
 */
interface EmailConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
}

/**
 * Parsed email structure from IMAP fetch.
 */
interface ParsedEmail {
  messageId: string;
  from: string;
  to: string;
  subject: string;
  date: Date;
  body: string;
  inReplyTo?: string;
  references?: string[];
}

/**
 * Get email configuration from environment variables.
 */
function getEmailConfig(): EmailConfig | null {
  const host = process.env.IMAP_HOST;
  const user = process.env.IMAP_USER;
  const password = process.env.IMAP_PASSWORD;

  if (!host || !user || !password) return null;

  return {
    host,
    port: parseInt(process.env.IMAP_PORT || "993", 10),
    user,
    password,
    tls: process.env.IMAP_TLS !== "false",
  };
}

/**
 * Sync emails from the configured mailbox and upsert them as CommsThreads.
 *
 * This function uses the imap-simple library to connect to an IMAP mailbox,
 * fetch unseen messages, and create/update CommsThreads accordingly.
 */
export async function syncEmailInbox(queue: string = "Ops") {
  const config = getEmailConfig();
  if (!config) {
    throw new Error(
      "Email not configured: IMAP_HOST, IMAP_USER, and IMAP_PASSWORD are required"
    );
  }

  // Dynamic imports for optional dependencies (not all deployments need email)
  const imapSimple = await import("imap-simple");
  const { simpleParser } = await import("mailparser");

  const imapConfig = {
    imap: {
      user: config.user,
      password: config.password,
      host: config.host,
      port: config.port,
      tls: config.tls,
      authTimeout: 10000,
      tlsOptions: { rejectUnauthorized: false },
    },
  };

  const connection = await imapSimple.connect(imapConfig);
  await connection.openBox("INBOX");

  // Search for unseen messages from last 7 days
  const searchCriteria = ["UNSEEN", ["SINCE", sevenDaysAgo()]];
  const fetchOptions = {
    bodies: ["HEADER", "TEXT", ""],
    markSeen: false,
  };

  const messages = await connection.search(searchCriteria, fetchOptions);
  const synced: string[] = [];

  for (const item of messages) {
    try {
      const allBody = item.parts.find((p: { which: string }) => p.which === "");
      if (!allBody) continue;

      const parsed = await simpleParser(allBody.body);
      const email: ParsedEmail = {
        messageId: parsed.messageId || `unknown-${Date.now()}`,
        from: extractAddress(parsed.from?.text || "Unknown"),
        to: extractAddress(parsed.to?.text || ""),
        subject: parsed.subject || "No Subject",
        date: parsed.date || new Date(),
        body: parsed.text || parsed.html?.replace(/<[^>]*>/g, "") || "",
        inReplyTo: parsed.inReplyTo
          ? String(parsed.inReplyTo)
          : undefined,
        references: parsed.references
          ? (Array.isArray(parsed.references) ? parsed.references.map(String) : [String(parsed.references)])
          : undefined,
      };

      // Determine thread grouping: use In-Reply-To or References for threading
      const threadRef = findThreadRef(email);
      const sourceRef = `email-${threadRef}`;

      // Check if thread already exists
      const existing = await prisma.commsThread.findFirst({
        where: { sourceThreadRef: sourceRef },
      });

      if (existing) {
        // Update last message time
        if (email.date > existing.lastMessageAt) {
          await prisma.commsThread.update({
            where: { id: existing.id },
            data: { lastMessageAt: email.date },
          });
        }

        // Add message if not already stored (deduplicate by messageId snippet)
        const existingMsg = await prisma.commsMessage.findFirst({
          where: {
            threadId: existing.id,
            bodySnippet: email.body.substring(0, 500),
          },
        });

        if (!existingMsg) {
          await prisma.commsMessage.create({
            data: {
              threadId: existing.id,
              authorName: email.from,
              authorType: "external",
              bodySnippet: email.body.substring(0, 2000),
              timestamp: email.date,
            },
          });
        }

        synced.push(existing.id);
      } else {
        // Create new thread
        const thread = await prisma.commsThread.create({
          data: {
            source: "email",
            sourceThreadRef: sourceRef,
            participants: JSON.stringify([email.from, email.to].filter(Boolean)),
            clientOrPartnerTag: extractDomain(email.from),
            subject: email.subject.substring(0, 200),
            priority: "P2",
            status: "Unassigned",
            queue,
            lastMessageAt: email.date,
            ttoDeadline: computeTtoDeadline(email.date, "P2" as ThreadPriority),
          },
        });

        // Create initial message
        await prisma.commsMessage.create({
          data: {
            threadId: thread.id,
            authorName: email.from,
            authorType: "external",
            bodySnippet: email.body.substring(0, 2000),
            timestamp: email.date,
          },
        });

        synced.push(thread.id);
      }
    } catch {
      // Skip malformed emails
      continue;
    }
  }

  connection.end();

  return { inbox: config.user, threadsSynced: synced.length };
}

/**
 * Send an email notification via SMTP.
 */
export async function sendEmailNotification(
  to: string,
  subject: string,
  body: string
) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (!host || !user || !pass) return;

  const nodemailer = await import("nodemailer");

  const transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || user,
    to,
    subject,
    text: body,
  });
}

// --- Helper functions ---

function sevenDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

function extractAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return match ? match[1] : raw.trim();
}

function extractDomain(email: string): string {
  const match = email.match(/@([^@>]+)/);
  return match ? match[1] : "unknown";
}

function findThreadRef(email: ParsedEmail): string {
  // Prefer In-Reply-To for threading
  if (email.inReplyTo) return email.inReplyTo;
  // Fallback to first reference
  if (email.references && email.references.length > 0) return email.references[0];
  // Use own messageId as thread root
  return email.messageId;
}
