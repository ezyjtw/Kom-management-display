/**
 * Slack ingestion service — fetches messages from registered Slack channels
 * and upserts them as CommsThreads and CommsMessages.
 *
 * Uses the SlackChannel registry, rate limiter, circuit breaker, and
 * background job queue for reliable, incremental synchronisation.
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { CircuitBreaker } from "@/lib/circuit-breaker";
import { acquireSlackToken } from "@/lib/slack-rate-limiter";
import { enqueueJob } from "@/lib/background-jobs";
import { sanitiseSlackMessage } from "@/lib/sanitize";
import { upsertSourceRecords } from "@/modules/integrations/source-records";
import { handleSlackIntake } from "@/modules/intake/slack-intake-service";
import { normaliseSubject, deriveAutoPriority } from "@/lib/thread-utils";
import { computeTtoDeadline } from "@/lib/sla";
import * as slackChannelRepo from "@/modules/slack/repositories/slack-channel-repository";
import { getSlackClient } from "@/lib/integrations/slack";
import type { ThreadPriority } from "@/types";

// Slack message subtypes we should skip
const SKIP_SUBTYPES = new Set([
  "channel_join",
  "channel_leave",
  "bot_message",
  "channel_topic",
  "channel_purpose",
  "channel_name",
]);

type SlackMessage = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Slack Web API message shape

export type IngestOutcome = "skipped" | "risk_signal" | "thread" | "thread_with_replies" | "reply";

/**
 * Route one Slack message by channel purpose (spec §8.4):
 * - gx_notifications: bot messages are NOT skipped; stored raw for the Risk
 *   Signal parser (TODO(CONFIRM-RISK-SOURCE));
 * - alerts_out: our own outbound channel, never ingested;
 * - everything else: root messages become CommsThreads, replies are synced
 *   by sync_slack_replies. channel_join and similar subtypes are always skipped.
 */
export async function ingestChannelMessage(
  slackChannel: { id: string; channelId: string; channelName: string; purpose: string; clientId: string | null },
  msg: SlackMessage,
  opts: { fromHistory?: boolean } = {},
): Promise<IngestOutcome> {
  if (!msg.ts || slackChannel.purpose === "alerts_out") return "skipped";

  if (slackChannel.purpose === "gx_notifications") {
    if (msg.subtype && msg.subtype !== "bot_message" && SKIP_SUBTYPES.has(msg.subtype)) return "skipped";
    await upsertSourceRecords("slack", "risk_signal_raw", [{
      externalId: `${slackChannel.channelId}:${msg.ts}`,
      occurredAt: new Date(parseFloat(msg.ts) * 1000),
      fields: {
        channel: slackChannel.channelName,
        botId: msg.bot_id ?? null,
        username: msg.username ?? null,
        text: sanitiseSlackMessage(String(msg.text ?? "")).slice(0, 4000),
      },
    }]);
    return "risk_signal";
  }

  if (msg.subtype && SKIP_SUBTYPES.has(msg.subtype)) return "skipped";

  const isRoot = !msg.thread_ts || msg.thread_ts === msg.ts;
  if (!isRoot) {
    // History polling handles replies via sync_slack_replies; pushed events enqueue it.
    if (opts.fromHistory) return "skipped";
    await enqueueJob(
      "sync_slack_replies",
      { channelId: slackChannel.channelId, threadTs: msg.thread_ts },
      { deduplicationKey: `slack_replies_${slackChannel.channelId}_${msg.thread_ts}` },
    );
    await handleSlackIntake(slackChannel, msg);
    return "reply";
  }

  const channelId = slackChannel.channelId;
  const msgTimestamp = new Date(parseFloat(msg.ts) * 1000);
  const rawText = msg.text || "New Slack message";
  const sanitisedText = sanitiseSlackMessage(rawText);
  const firstLine = sanitisedText.split("\n")[0];
  const subject = normaliseSubject(firstLine);
  const autoPriority =
    deriveAutoPriority({ subject: rawText, body: rawText }) ?? ("P2" as ThreadPriority);

  // Upsert CommsThread using @@unique[slackChannelId, slackRootTs]
  await prisma.commsThread.upsert({
    where: {
      slackChannelId_slackRootTs: {
        slackChannelId: slackChannel.id,
        slackRootTs: msg.ts,
      },
    },
    create: {
      source: "slack",
      sourceThreadRef: `${channelId}-${msg.ts}`,
      slackChannelId: slackChannel.id,
      slackRootTs: msg.ts,
      slackThreadTs: msg.thread_ts || msg.ts,
      isSlackThread: (msg.reply_count || 0) > 0,
      slackReplyCount: msg.reply_count || 0,
      slackLastReplyTs: msg.latest_reply || null,
      subject,
      priority: autoPriority,
      status: "Unassigned",
      queue: "Transaction Operations",
      participants: JSON.stringify([msg.user]),
      clientOrPartnerTag: `#${slackChannel.channelName}`,
      lastMessageAt: msgTimestamp,
      ttoDeadline: computeTtoDeadline(msgTimestamp, autoPriority as ThreadPriority),
    },
    update: {
      isSlackThread: (msg.reply_count || 0) > 0,
      slackReplyCount: msg.reply_count || 0,
      slackLastReplyTs: msg.latest_reply || null,
      lastMessageAt: msgTimestamp,
    },
  });

  // Also upsert the root message in CommsMessage
  await prisma.commsMessage.upsert({
    where: {
      threadId_slackTs: {
        threadId: (
          await prisma.commsThread.findUnique({
            where: {
              slackChannelId_slackRootTs: {
                slackChannelId: slackChannel.id,
                slackRootTs: msg.ts,
              },
            },
            select: { id: true },
          })
        )!.id,
        slackTs: msg.ts,
      },
    },
    create: {
      threadId: (
        await prisma.commsThread.findUnique({
          where: {
            slackChannelId_slackRootTs: {
              slackChannelId: slackChannel.id,
              slackRootTs: msg.ts,
            },
          },
          select: { id: true },
        })
      )!.id,
      slackTs: msg.ts,
      slackUserId: msg.user || null,
      isRootMessage: true,
      authorName: msg.user || "Unknown",
      authorType: "external",
      bodySnippet: sanitisedText.substring(0, 2000),
      timestamp: msgTimestamp,
    },
    update: {
      bodySnippet: sanitisedText.substring(0, 2000),
      editedAt: msg.edited ? new Date(parseFloat(msg.edited.ts) * 1000) : undefined,
    },
  });

  // Client intake (spec §9.2); no-op unless intake.slack.route = "kommand"
  await handleSlackIntake(slackChannel, msg);

  // If message has replies, enqueue reply sync
  if (msg.reply_count && msg.reply_count > 0) {
    await enqueueJob(
      "sync_slack_replies",
      { channelId, threadTs: msg.ts },
      { deduplicationKey: `slack_replies_${channelId}_${msg.ts}` },
    );
    return "thread_with_replies";
  }
  return "thread";
}

/**
 * Sync channel messages (root messages only).
 *
 * For each root message:
 *  - Upserts a CommsThread using the @@unique[slackChannelId, slackRootTs] constraint
 *  - If the message has replies, enqueues a sync_slack_replies job
 *
 * Wrapped in CircuitBreaker for resilience.
 */
export async function syncChannelMessages(channelId: string): Promise<{
  channelId: string;
  threadsUpserted: number;
  repliesEnqueued: number;
}> {
  return CircuitBreaker.for("slack_channel_sync").execute(async () => {
    // Fetch the channel record
    const slackChannel = await slackChannelRepo.findByChannelId(channelId);
    if (!slackChannel) {
      logger.warn("syncChannelMessages: channel not found in registry", { channelId });
      return { channelId, threadsUpserted: 0, repliesEnqueued: 0 };
    }
    if (!slackChannel.isActive) {
      logger.info("syncChannelMessages: channel is inactive, skipping", { channelId });
      return { channelId, threadsUpserted: 0, repliesEnqueued: 0 };
    }

    const client = getSlackClient();
    if (!client) {
      throw new Error("Slack not configured: SLACK_BOT_TOKEN is missing");
    }

    // Rate limit
    await acquireSlackToken();

    // Fetch messages incrementally using syncCursor
    const historyOpts: { channel: string; limit: number; oldest?: string } = {
      channel: channelId,
      limit: 200,
    };
    if (slackChannel.syncCursor) {
      historyOpts.oldest = slackChannel.syncCursor;
    }

    const result = await client.conversations.history(historyOpts);
    const messages = (result.messages || []) as SlackMessage[];

    let threadsUpserted = 0;
    let repliesEnqueued = 0;
    let latestTs: string | null = null;

    for (const msg of messages) {
      if (!msg.ts) continue;
      const outcome = await ingestChannelMessage(slackChannel, msg, { fromHistory: true });
      if (outcome === "skipped") continue;
      if (outcome !== "risk_signal") threadsUpserted++;

      // Track latest ts for cursor update
      if (!latestTs || msg.ts > latestTs) {
        latestTs = msg.ts;
      }
      if (outcome === "thread_with_replies") repliesEnqueued++;
    }

    // Update sync cursor to the latest message ts
    if (latestTs) {
      await slackChannelRepo.updateCursor(channelId, latestTs);
    }

    logger.integration("slack", `Channel sync complete for ${channelId}`, {
      threadsUpserted,
      repliesEnqueued,
    });

    return { channelId, threadsUpserted, repliesEnqueued };
  });
}

/**
 * Sync replies for a specific thread.
 *
 * Fetches all replies via conversations.replies, skips the root message,
 * and upserts each as a CommsMessage.
 *
 * Wrapped in CircuitBreaker for resilience.
 */
export async function syncThreadReplies(
  channelId: string,
  threadTs: string,
): Promise<{ messagesUpserted: number }> {
  return CircuitBreaker.for("slack_reply_sync").execute(async () => {
    // Find the SlackChannel record
    const slackChannel = await slackChannelRepo.findByChannelId(channelId);
    if (!slackChannel) {
      logger.warn("syncThreadReplies: channel not found in registry", { channelId });
      return { messagesUpserted: 0 };
    }

    // Find parent thread
    const parentThread = await prisma.commsThread.findUnique({
      where: {
        slackChannelId_slackRootTs: {
          slackChannelId: slackChannel.id,
          slackRootTs: threadTs,
        },
      },
    });

    if (!parentThread) {
      logger.warn("syncThreadReplies: parent thread not found", { channelId, threadTs });
      return { messagesUpserted: 0 };
    }

    const client = getSlackClient();
    if (!client) {
      throw new Error("Slack not configured: SLACK_BOT_TOKEN is missing");
    }

    // Rate limit
    await acquireSlackToken();

    const repliesResult = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 200,
    });

    const replies = (repliesResult.messages || []) as SlackMessage[];
    let messagesUpserted = 0;
    let latestReplyTs: string | null = null;

    // Skip first message (it's the root)
    for (const reply of replies.slice(1)) {
      if (!reply.ts || !reply.text) continue;

      const sanitisedText = sanitiseSlackMessage(reply.text);
      const replyTimestamp = new Date(parseFloat(reply.ts) * 1000);

      await prisma.commsMessage.upsert({
        where: {
          threadId_slackTs: {
            threadId: parentThread.id,
            slackTs: reply.ts,
          },
        },
        create: {
          threadId: parentThread.id,
          slackTs: reply.ts,
          slackUserId: reply.user || null,
          slackThreadTs: threadTs,
          isRootMessage: false,
          authorName: reply.user || "Unknown",
          authorType: "external",
          bodySnippet: sanitisedText.substring(0, 2000),
          timestamp: replyTimestamp,
          slackReactions: reply.reactions ? JSON.stringify(reply.reactions) : undefined,
        },
        update: {
          bodySnippet: sanitisedText.substring(0, 2000),
          editedAt: reply.edited ? new Date(parseFloat(reply.edited.ts) * 1000) : undefined,
          slackReactions: reply.reactions ? JSON.stringify(reply.reactions) : undefined,
        },
      });

      messagesUpserted++;
      await handleSlackIntake(slackChannel, reply);

      if (!latestReplyTs || reply.ts > latestReplyTs) {
        latestReplyTs = reply.ts;
      }
    }

    // Update parent thread metadata
    if (latestReplyTs) {
      await prisma.commsThread.update({
        where: { id: parentThread.id },
        data: {
          slackReplyCount: replies.length - 1, // exclude root
          slackLastReplyTs: latestReplyTs,
          lastMessageAt: new Date(parseFloat(latestReplyTs) * 1000),
        },
      });
    }

    logger.integration("slack", `Reply sync complete for thread ${threadTs} in ${channelId}`, {
      messagesUpserted,
    });

    return { messagesUpserted };
  });
}
