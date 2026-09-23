import { prisma } from "@/lib/prisma";
import { ingestChannelMessage } from "@/modules/slack/services/slack-ingestion-service";
import { recordHeartbeat } from "@/modules/integrations/heartbeat";

export const SLACK_HEARTBEAT = { source: "slack.events", expectedEveryMins: 5 };

/** Process one queued Slack message event. Unregistered or inactive channels are ignored. */
export async function processSlackEvent(payload: Record<string, unknown>) {
  const event = payload.event as Record<string, unknown> | undefined;
  const channelId = typeof event?.channel === "string" ? event.channel : null;
  if (!event || !channelId) return { ignored: "no channel" };

  const channel = await prisma.slackChannel.findUnique({ where: { channelId } });
  if (!channel?.isActive) return { ignored: "channel not registered or inactive" };

  const outcome = await ingestChannelMessage(channel, event);
  const ts = typeof event.ts === "string" ? new Date(parseFloat(event.ts) * 1000) : null;
  await recordHeartbeat(SLACK_HEARTBEAT.source, { count: 1, newestRecordAt: ts, expectedEveryMins: SLACK_HEARTBEAT.expectedEveryMins });
  return { outcome };
}
