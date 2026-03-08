/**
 * Email / IMAP integration adapter.
 *
 * Wraps the existing email sync logic from src/lib/integrations/email.ts
 * behind the IntegrationAdapter interface with proper IMAP connection
 * management, thread linking, participant extraction, attachment metadata,
 * and deduplication of forwarded messages.
 */

import { logger } from "@/lib/logger";
import type {
  IntegrationAdapter,
  IntegrationHealth,
  NormalizedEvent,
  NormalizedPayload,
} from "@/modules/integrations/types";

// ---------------------------------------------------------------------------
// Email types
// ---------------------------------------------------------------------------

interface EmailConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
}

interface ParsedEmail {
  messageId: string;
  from: string;
  to: string;
  cc?: string;
  subject: string;
  date: Date;
  body: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: AttachmentMeta[];
}

interface AttachmentMeta {
  filename: string;
  contentType: string;
  size: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function extractAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return match ? match[1] : raw.trim();
}

function extractAllAddresses(raw: string): string[] {
  const addresses: string[] = [];
  const regex = /<([^>]+)>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    addresses.push(match[1]);
  }
  if (addresses.length === 0 && raw.trim()) {
    // Bare address without angle brackets
    addresses.push(...raw.split(",").map((a) => a.trim()).filter(Boolean));
  }
  return addresses;
}

function extractDomain(email: string): string {
  const match = email.match(/@([^@>]+)/);
  return match ? match[1] : "unknown";
}

/**
 * Determine the thread reference for email threading.
 * Uses In-Reply-To first, then the first References header, then the message's own ID.
 */
function findThreadRef(email: ParsedEmail): string {
  if (email.inReplyTo) return email.inReplyTo;
  if (email.references && email.references.length > 0) return email.references[0];
  return email.messageId;
}

/**
 * Normalise alias addresses by stripping +suffix before the @.
 * e.g. ops+alerts@company.com -> ops@company.com
 */
function normaliseEmailAddress(addr: string): string {
  return addr.replace(/\+[^@]*@/, "@").toLowerCase();
}

function sevenDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

function mapEmailToEvent(email: ParsedEmail): NormalizedEvent {
  const threadRef = findThreadRef(email);
  const sourceId = `email-${threadRef}`;
  const isReply = !!email.inReplyTo || (email.references && email.references.length > 0);

  // Collect all participants
  const participants: NormalizedPayload["participants"] = [];
  const fromAddr = normaliseEmailAddress(extractAddress(email.from));
  participants.push({ name: fromAddr, email: fromAddr, role: "sender" });

  for (const addr of extractAllAddresses(email.to)) {
    const norm = normaliseEmailAddress(addr);
    participants.push({ name: norm, email: norm, role: "to" });
  }
  if (email.cc) {
    for (const addr of extractAllAddresses(email.cc)) {
      const norm = normaliseEmailAddress(addr);
      participants.push({ name: norm, email: norm, role: "cc" });
    }
  }

  return {
    id: `email-${email.messageId}`,
    sourceSystem: "email",
    sourceId,
    entityType: isReply ? "message" : "thread",
    eventType: isReply ? "commented" : "created",
    occurredAt: email.date,
    receivedAt: new Date(),
    payload: {
      subject: email.subject,
      body: email.body.substring(0, 4000),
      actor: {
        name: fromAddr,
        email: fromAddr,
      },
      participants,
      metadata: {
        messageId: email.messageId,
        inReplyTo: email.inReplyTo,
        references: email.references,
        domain: extractDomain(fromAddr),
        attachments: email.attachments ?? [],
        attachmentCount: email.attachments?.length ?? 0,
      },
    },
    rawPayload: {
      messageId: email.messageId,
      from: email.from,
      to: email.to,
      cc: email.cc,
      subject: email.subject,
      date: email.date.toISOString(),
      inReplyTo: email.inReplyTo,
      references: email.references,
    },
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class EmailAdapter implements IntegrationAdapter {
  readonly source = "email" as const;

  private lastSuccessfulSync: Date | null = null;
  private lastFailure: Date | null = null;
  private lastFailureMessage?: string;
  private failureCount = 0;

  /** Track message IDs we have already processed for dedup of forwards. */
  private seenMessageIds = new Set<string>();
  private static readonly MAX_SEEN_SIZE = 10_000;

  isConfigured(): boolean {
    return getEmailConfig() !== null;
  }

  async sync(opts?: Record<string, unknown>): Promise<NormalizedEvent[]> {
    const config = getEmailConfig();
    if (!config) {
      logger.warn("Email adapter not configured, skipping sync");
      return [];
    }

    let connection: { search: Function; end: Function; openBox: Function } | null = null;

    try {
      logger.info("Email sync starting", { host: config.host, user: config.user });

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

      connection = await imapSimple.connect(imapConfig);
      await connection.openBox((opts?.mailbox as string) ?? "INBOX");

      const searchCriteria = ["UNSEEN", ["SINCE", sevenDaysAgo()]];
      const fetchOptions = {
        bodies: ["HEADER", "TEXT", ""],
        markSeen: false,
      };

      const messages = await connection.search(searchCriteria, fetchOptions);
      const events: NormalizedEvent[] = [];

      for (const item of messages) {
        try {
          const allBody = item.parts.find(
            (p: { which: string }) => p.which === "",
          );
          if (!allBody) continue;

          const parsed = await simpleParser(allBody.body);
          const messageId = parsed.messageId || `unknown-${Date.now()}-${Math.random()}`;

          // Deduplicate: skip if we have already processed this exact message ID
          const normalisedId = messageId.toLowerCase().trim();
          if (this.seenMessageIds.has(normalisedId)) {
            continue;
          }
          if (this.seenMessageIds.size >= EmailAdapter.MAX_SEEN_SIZE) {
            const first = this.seenMessageIds.values().next().value;
            if (first !== undefined) {
              this.seenMessageIds.delete(first);
            }
          }
          this.seenMessageIds.add(normalisedId);

          // Extract attachment metadata (without downloading full bodies)
          const rawAttachments = (parsed as unknown as { attachments?: Array<{ filename?: string; contentType?: string; size?: number }> }).attachments ?? [];
          const attachments: AttachmentMeta[] = rawAttachments.map(
            (att) => ({
              filename: att.filename ?? "unnamed",
              contentType: att.contentType ?? "application/octet-stream",
              size: att.size ?? 0,
            }),
          );

          const email: ParsedEmail = {
            messageId,
            from: parsed.from?.text || "Unknown",
            to: parsed.to?.text || "",
            cc: (parsed as unknown as { cc?: { text?: string } }).cc?.text || undefined,
            subject: parsed.subject || "No Subject",
            date: parsed.date || new Date(),
            body: parsed.text || parsed.html?.replace(/<[^>]*>/g, "") || "",
            inReplyTo: parsed.inReplyTo ? String(parsed.inReplyTo) : undefined,
            references: parsed.references
              ? Array.isArray(parsed.references)
                ? parsed.references.map(String)
                : [String(parsed.references)]
              : undefined,
            attachments,
          };

          events.push(mapEmailToEvent(email));
        } catch {
          // Skip malformed emails
          continue;
        }
      }

      this.lastSuccessfulSync = new Date();
      this.failureCount = 0;
      logger.info("Email sync completed", { fetched: events.length });
      return events;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastFailure = new Date();
      this.lastFailureMessage = message;
      this.failureCount++;
      logger.error("Email sync failed", {
        error: message,
        failureCount: this.failureCount,
      });
      return [];
    } finally {
      // Always clean up the IMAP connection
      try {
        connection?.end();
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  getLastSyncTime(): Date | null {
    return this.lastSuccessfulSync;
  }

  getHealth(): IntegrationHealth {
    const configured = this.isConfigured();
    let status: IntegrationHealth["status"] = "unconfigured";

    if (configured) {
      if (this.failureCount === 0 && this.lastSuccessfulSync) {
        status = "healthy";
      } else if (this.failureCount > 0 && this.failureCount < 3) {
        status = "degraded";
      } else if (this.failureCount >= 3) {
        status = "down";
      } else {
        status = "healthy";
      }
    }

    return {
      source: this.source,
      configured,
      lastSuccessfulSync: this.lastSuccessfulSync,
      lastFailure: this.lastFailure,
      lastFailureMessage: this.lastFailureMessage,
      queueBacklog: 0,
      failureCount: this.failureCount,
      status,
    };
  }
}
