import { WebClient } from "@slack/web-api";
import { prisma } from "@/lib/prisma";
import { computeTtoDeadline } from "@/lib/sla";
import type { ThreadPriority } from "@/types";

let slackClient: WebClient | null = null;

function getSlackClient(): WebClient | null {
  if (!process.env.SLACK_BOT_TOKEN) return null;
  if (!slackClient) {
    slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
  }
  return slackClient;
}

/**
 * Fetch messages from a Slack channel and upsert them as CommsThreads.
 */
export async function syncSlackChannel(channelId: string, queue: string = "Ops") {
  const client = getSlackClient();
  if (!client) throw new Error("Slack not configured: SLACK_BOT_TOKEN is missing");

  // Fetch channel info
  const channelInfo = await client.conversations.info({ channel: channelId });
  const channelName = (channelInfo.channel as any)?.name || channelId;

  // Fetch recent messages (last 100)
  const result = await client.conversations.history({
    channel: channelId,
    limit: 100,
  });

  const messages = result.messages || [];
  const synced: string[] = [];

  for (const msg of messages) {
    if (!msg.ts || msg.subtype === "channel_join" || msg.subtype === "channel_leave") {
      continue;
    }

    const sourceRef = `${channelId}-${msg.thread_ts || msg.ts}`;

    // Check if thread already exists
    const existing = await prisma.commsThread.findFirst({
      where: { sourceThreadRef: sourceRef },
    });

    if (existing) {
      // Update last message time if newer
      const msgTime = new Date(parseFloat(msg.ts!) * 1000);
      if (msgTime > existing.lastMessageAt) {
        await prisma.commsThread.update({
          where: { id: existing.id },
          data: { lastMessageAt: msgTime },
        });
      }

      // Add message if not already stored
      const existingMsg = await prisma.commsMessage.findFirst({
        where: {
          threadId: existing.id,
          bodySnippet: (msg.text || "").substring(0, 500),
        },
      });

      if (!existingMsg && msg.text) {
        await prisma.commsMessage.create({
          data: {
            threadId: existing.id,
            authorName: msg.user || "Unknown",
            authorType: "external",
            bodySnippet: (msg.text || "").substring(0, 2000),
            timestamp: new Date(parseFloat(msg.ts!) * 1000),
          },
        });
      }

      synced.push(existing.id);
      continue;
    }

    // Create new thread
    const now = new Date(parseFloat(msg.ts!) * 1000);
    const subject = (msg.text || "New Slack message").substring(0, 200);

    const thread = await prisma.commsThread.create({
      data: {
        source: "slack",
        sourceThreadRef: sourceRef,
        participants: JSON.stringify([msg.user]),
        clientOrPartnerTag: `#${channelName}`,
        subject,
        priority: "P2",
        status: "Unassigned",
        queue,
        lastMessageAt: now,
        ttoDeadline: computeTtoDeadline(now, "P2" as ThreadPriority),
      },
    });

    // Create initial message
    if (msg.text) {
      await prisma.commsMessage.create({
        data: {
          threadId: thread.id,
          authorName: msg.user || "Unknown",
          authorType: "external",
          bodySnippet: msg.text.substring(0, 2000),
          timestamp: now,
        },
      });
    }

    synced.push(thread.id);
  }

  // If the channel has threads, sync thread replies too
  for (const msg of messages) {
    if (msg.thread_ts && msg.reply_count && msg.reply_count > 0) {
      const sourceRef = `${channelId}-${msg.thread_ts}`;
      const parentThread = await prisma.commsThread.findFirst({
        where: { sourceThreadRef: sourceRef },
      });

      if (parentThread) {
        try {
          const replies = await client.conversations.replies({
            channel: channelId,
            ts: msg.thread_ts,
            limit: 50,
          });

          for (const reply of (replies.messages || []).slice(1)) { // skip parent
            if (!reply.text) continue;
            const existingReply = await prisma.commsMessage.findFirst({
              where: {
                threadId: parentThread.id,
                bodySnippet: reply.text.substring(0, 500),
              },
            });

            if (!existingReply) {
              await prisma.commsMessage.create({
                data: {
                  threadId: parentThread.id,
                  authorName: reply.user || "Unknown",
                  authorType: "external",
                  bodySnippet: reply.text.substring(0, 2000),
                  timestamp: new Date(parseFloat(reply.ts!) * 1000),
                },
              });
            }
          }
        } catch {
          // Rate limiting or permission issue — skip this thread
        }
      }
    }
  }

  return { channelId, channelName, threadsSynced: synced.length };
}

/**
 * Post a notification to a Slack channel.
 */
export async function sendSlackNotification(channel: string, text: string) {
  const client = getSlackClient();
  if (!client) return;

  await client.chat.postMessage({ channel, text });
}
