/**
 * Slack integration adapter.
 *
 * Wraps the existing Slack WebClient logic from src/lib/integrations/slack.ts
 * behind the IntegrationAdapter interface with webhook signature verification,
 * event deduplication, and health tracking.
 */

import { logger } from "@/lib/logger";
import type {
  IntegrationAdapter,
  IntegrationHealth,
  NormalizedEvent,
  NormalizedPayload,
} from "@/modules/integrations/types";

// ---------------------------------------------------------------------------
// Slack types
// ---------------------------------------------------------------------------

interface SlackMessage {
  ts?: string;
  thread_ts?: string;
  text?: string;
  user?: string;
  subtype?: string;
  reply_count?: number;
  channel?: string;
  event_id?: string;
}

interface SlackChannelInfo {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSlackConfigured(): boolean {
  return !!process.env.SLACK_BOT_TOKEN;
}

function getSigningSecret(): string | null {
  return process.env.SLACK_SIGNING_SECRET ?? null;
}

/**
 * Verify a Slack webhook request signature.
 * See: https://api.slack.com/authentication/verifying-requests-from-slack
 */
export async function verifySlackSignature(
  signingSecret: string,
  signature: string,
  timestamp: string,
  body: string,
): Promise<boolean> {
  try {
    const crypto = await import("crypto");
    const baseString = `v0:${timestamp}:${body}`;
    const hmac = crypto.createHmac("sha256", signingSecret).update(baseString).digest("hex");
    const expected = `v0=${hmac}`;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

function mapSlackMessageToEvent(
  msg: SlackMessage,
  channelId: string,
  channelName: string,
): NormalizedEvent {
  const ts = msg.ts ? parseFloat(msg.ts) * 1000 : Date.now();
  const occurredAt = new Date(ts);
  const sourceId = `${channelId}-${msg.thread_ts || msg.ts}`;

  const payload: NormalizedPayload = {
    subject: msg.text?.split("\n")[0]?.substring(0, 200) ?? "Slack message",
    body: msg.text ?? undefined,
    actor: msg.user ? { name: msg.user, sourceId: msg.user } : undefined,
    participants: msg.user ? [{ name: msg.user, role: "author" }] : [],
    metadata: {
      channelId,
      channelName,
      threadTs: msg.thread_ts,
      messageTs: msg.ts,
      replyCount: msg.reply_count,
    },
  };

  return {
    id: `slack-${sourceId}-${msg.ts}`,
    sourceSystem: "slack",
    sourceId,
    entityType: "message",
    eventType: "created",
    occurredAt,
    receivedAt: new Date(),
    payload,
    rawPayload: msg as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class SlackAdapter implements IntegrationAdapter {
  readonly source = "slack" as const;

  private lastSuccessfulSync: Date | null = null;
  private lastFailure: Date | null = null;
  private lastFailureMessage?: string;
  private failureCount = 0;

  /** Set of event IDs already processed for deduplication. */
  private processedEventIds = new Set<string>();
  /** Cap the dedup set to prevent unbounded growth. */
  private static readonly MAX_DEDUP_SIZE = 10_000;

  isConfigured(): boolean {
    return isSlackConfigured();
  }

  /**
   * Verify a webhook request signature.
   * Returns false if the signing secret is not configured.
   */
  async verifyWebhook(signature: string, timestamp: string, body: string): Promise<boolean> {
    const secret = getSigningSecret();
    if (!secret) {
      logger.warn("Slack signing secret not configured, rejecting webhook");
      return false;
    }
    return verifySlackSignature(secret, signature, timestamp, body);
  }

  /**
   * Check whether an event has already been processed (deduplication).
   * Returns true if the event is new (not a duplicate).
   */
  acceptEvent(eventId: string): boolean {
    if (this.processedEventIds.has(eventId)) {
      return false;
    }
    // Evict oldest entries when the set grows too large
    if (this.processedEventIds.size >= SlackAdapter.MAX_DEDUP_SIZE) {
      const first = this.processedEventIds.values().next().value;
      if (first !== undefined) {
        this.processedEventIds.delete(first);
      }
    }
    this.processedEventIds.add(eventId);
    return true;
  }

  async sync(opts?: Record<string, unknown>): Promise<NormalizedEvent[]> {
    if (!isSlackConfigured()) {
      logger.warn("Slack adapter not configured, skipping sync");
      return [];
    }

    const channelId = opts?.channelId as string | undefined;
    if (!channelId) {
      logger.warn("Slack sync requires channelId in opts");
      return [];
    }

    try {
      logger.info("Slack sync starting", { channelId });

      // Dynamic import so the adapter file can be loaded even without @slack/web-api
      const { WebClient } = await import("@slack/web-api");
      const client = new WebClient(process.env.SLACK_BOT_TOKEN);

      // Channel info
      const channelInfo = await client.conversations.info({ channel: channelId });
      const channelName =
        (channelInfo.channel as SlackChannelInfo | undefined)?.name ?? channelId;

      // Fetch recent messages
      const limit = (opts?.limit as number) ?? 100;
      const result = await client.conversations.history({ channel: channelId, limit });
      const messages: SlackMessage[] = (result.messages as SlackMessage[]) ?? [];

      const events: NormalizedEvent[] = [];

      for (const msg of messages) {
        if (!msg.ts || msg.subtype === "channel_join" || msg.subtype === "channel_leave") {
          continue;
        }

        // Deduplication
        const eventKey = `${channelId}-${msg.ts}`;
        if (!this.acceptEvent(eventKey)) continue;

        events.push(mapSlackMessageToEvent(msg, channelId, channelName));
      }

      this.lastSuccessfulSync = new Date();
      this.failureCount = 0;
      logger.info("Slack sync completed", { channelId, events: events.length });
      return events;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastFailure = new Date();
      this.lastFailureMessage = message;
      this.failureCount++;
      logger.error("Slack sync failed", { error: message, failureCount: this.failureCount });
      return [];
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
