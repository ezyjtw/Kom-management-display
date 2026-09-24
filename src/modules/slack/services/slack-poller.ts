/**
 * Slack polling, the required mechanism (spec §6.1, §8.4): every registered
 * channel is polled exactly once per 5-minute cycle, 24/7 — never paused out
 * of hours. Each cycle reads conversations.history from the channel's cursor
 * and then conversations.replies for threads with new replies, so nothing is
 * missed if a cycle is late. Push events (flag slack.events_push) only cut
 * latency; polling stays on as the completeness guarantee.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { acquireSlackToken } from "@/lib/slack-rate-limiter";
import { getSlackClient } from "@/lib/integrations/slack";
import { recordHeartbeat } from "@/modules/integrations/heartbeat";
import { recordPollCycle } from "@/modules/integrations/poll-cycles";
import * as slackChannelRepo from "@/modules/slack/repositories/slack-channel-repository";
import { ingestChannelMessage, syncThreadReplies } from "@/modules/slack/services/slack-ingestion-service";

export const SLACK_HEARTBEAT = { source: "slack.channels", expectedEveryMins: 5 } as const;
/** How far back parents are checked for new replies. */
export const REPLY_LOOKBACK_DAYS = 7;
const MAX_PAGES = 5;

type SlackMessage = { ts?: string; thread_ts?: string; latest_reply?: string; reply_count?: number } & Record<string, unknown>;

const tsToDate = (ts: string) => new Date(parseFloat(ts) * 1000);

/** One channel: new root messages since the cursor, then replies on threads whose latest_reply moved on. */
export async function pollChannel(channelId: string, now = new Date()): Promise<{ newMessages: number; threadsWithNewReplies: number; newest: Date | null }> {
  const channel = await slackChannelRepo.findByChannelId(channelId);
  const client = getSlackClient();
  if (!channel?.isActive || !client) return { newMessages: 0, threadsWithNewReplies: 0, newest: null };

  const lookback = String((now.getTime() - REPLY_LOOKBACK_DAYS * 86_400_000) / 1000);
  const oldest = channel.syncCursor && channel.syncCursor < lookback ? channel.syncCursor : lookback;
  const messages: SlackMessage[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    await acquireSlackToken();
    const res = await client.conversations.history({ channel: channelId, oldest, limit: 200, cursor });
    messages.push(...((res.messages ?? []) as SlackMessage[]));
    cursor = res.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }

  let newMessages = 0;
  let latest = channel.syncCursor ?? null;
  for (const msg of messages) {
    if (!msg.ts || (channel.syncCursor && msg.ts <= channel.syncCursor)) continue;
    const outcome = await ingestChannelMessage(channel, msg as never, { fromHistory: true });
    if (outcome !== "skipped") newMessages++;
    if (!latest || msg.ts > latest) latest = msg.ts;
  }
  if (latest && latest !== channel.syncCursor) await slackChannelRepo.updateCursor(channelId, latest);

  // Replies: parents in the window whose latest reply is newer than what we stored.
  let threadsWithNewReplies = 0;
  const parents = messages.filter((m) => m.ts && m.latest_reply && (!m.thread_ts || m.thread_ts === m.ts));
  if (parents.length) {
    const stored = await prisma.commsThread.findMany({
      where: { slackChannelId: channel.id, slackRootTs: { in: parents.map((p) => p.ts!) } },
      select: { slackRootTs: true, slackLastReplyTs: true },
    });
    const lastReply = new Map(stored.map((t) => [t.slackRootTs, t.slackLastReplyTs]));
    for (const p of parents) {
      if (!lastReply.has(p.ts!)) continue; // root not ingested (skipped subtype or channel purpose)
      const known = lastReply.get(p.ts!);
      if (known && p.latest_reply! <= known) continue;
      await syncThreadReplies(channelId, p.ts!);
      threadsWithNewReplies++;
    }
  }
  const newestTs = [latest, ...parents.map((p) => p.latest_reply!)].filter(Boolean).sort().at(-1);
  return { newMessages, threadsWithNewReplies, newest: newestTs ? tsToDate(newestTs) : null };
}

/** Job `sync_slack` (every 5 minutes, 24/7). */
export async function pollAllSlackChannels(now = new Date()) {
  const startedAt = new Date();
  if (!getSlackClient()) {
    await recordPollCycle("slack", startedAt, false, 0, "Slack not configured");
    return { skipped: true, reason: "Slack not configured" };
  }
  const channels = await slackChannelRepo.findAllActive();
  let ok = 0;
  let count = 0;
  let newest: Date | null = null;
  const failed: string[] = [];
  for (const ch of channels) {
    if (ch.purpose === "alerts_out") continue;
    try {
      const r = await pollChannel(ch.channelId, now);
      ok++;
      count += r.newMessages;
      if (r.newest && (!newest || r.newest > newest)) newest = r.newest;
    } catch (error) {
      failed.push(ch.channelId);
      logger.error("Slack channel poll failed; retried next cycle", { channelId: ch.channelId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const success = failed.length === 0 || ok > 0;
  if (success) await recordHeartbeat(SLACK_HEARTBEAT.source, { count, newestRecordAt: newest, expectedEveryMins: SLACK_HEARTBEAT.expectedEveryMins });
  await recordPollCycle("slack", startedAt, success, count, failed.length ? `${failed.length} channel(s) failed` : null);
  if (!success) throw new Error("Slack poll failed for every channel");
  return { channels: channels.length, polled: ok, failed: failed.length, newMessages: count };
}
