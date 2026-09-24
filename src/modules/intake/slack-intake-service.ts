/**
 * Slack client intake — the `kommand` route (spec §9.1, §9.2).
 *
 * Runs only when intake.slack.route = "kommand", and only for channels with
 * purpose=client and a linked client. With "jsm_native" or "off" it does
 * nothing: JSM's own Slack integration (or nobody) creates requests.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getSlackClient } from "@/lib/integrations/slack";
import { sanitiseSlackMessage } from "@/lib/sanitize";
import { getSettings } from "@/modules/settings/settings";
import {
  processIntakeDelete,
  processIntakeEdit,
  processIntakeMessage,
  type AuthorKind,
  type IntakeOutcome,
} from "@/modules/intake/intake-core";

type SlackMessage = Record<string, unknown>;
type Channel = { id: string; channelId: string; purpose: string; clientId: string | null };

const str = (v: unknown) => (typeof v === "string" ? v : null);

/**
 * External = the author's Slack team differs from Komainu's workspace, or the
 * user is mapped to the client (ClientChannel kind "slack_user"). Missing team
 * information counts as external: over-capture is intentional (spec §9.2 rule 2).
 */
export function classifySlackAuthor(msg: SlackMessage, komainuTeamId: string, mappedUsers: ReadonlySet<string>): AuthorKind {
  if (str(msg.bot_id) || msg.subtype === "bot_message") return "bot";
  const user = str(msg.user);
  if (user && mappedUsers.has(user)) return "external";
  const team = str(msg.user_team) ?? str(msg.team) ?? str(msg.source_team);
  if (!team) return "external";
  return team === komainuTeamId ? "staff" : "external";
}

type Eligibility =
  | { ok: false; reason: string }
  | { ok: true; komainuTeamId: string; client: { id: string; displayName: string; jsmOrganizationId: string | null }; mappedUsers: Set<string> };

async function eligibility(channel: Channel): Promise<Eligibility> {
  const cfg = await getSettings(["intake.slack.route", "intake.slack.komainuTeamId"] as const);
  if (cfg["intake.slack.route"] !== "kommand") return { ok: false, reason: `route is ${cfg["intake.slack.route"]}` };
  if (channel.purpose !== "client" || !channel.clientId) return { ok: false, reason: "not a client channel" };
  if (!cfg["intake.slack.komainuTeamId"]) {
    logger.error("Slack intake route is kommand but intake.slack.komainuTeamId is not set");
    return { ok: false, reason: "komainu team id not set" };
  }
  const client = await prisma.client.findUnique({
    where: { id: channel.clientId },
    select: { id: true, displayName: true, jsmOrganizationId: true, isActive: true, channels: { where: { kind: "slack_user" }, select: { ref: true } } },
  });
  if (!client?.isActive) return { ok: false, reason: "client missing or inactive" };
  return {
    ok: true,
    komainuTeamId: cfg["intake.slack.komainuTeamId"],
    client: { id: client.id, displayName: client.displayName, jsmOrganizationId: client.jsmOrganizationId },
    mappedUsers: new Set(client.channels.map((c) => c.ref)),
  };
}

async function permalink(channelId: string, ts: string): Promise<string | null> {
  try {
    const res = await getSlackClient()?.chat.getPermalink({ channel: channelId, message_ts: ts });
    return res?.permalink ?? null;
  } catch {
    return null;
  }
}

/** Handle a new Slack message (root or reply) from the Events API or polling. */
export async function handleSlackIntake(channel: Channel, msg: SlackMessage): Promise<IntakeOutcome | "skipped"> {
  const ts = str(msg.ts);
  if (!ts) return "skipped";
  const elig = await eligibility(channel);
  if (!elig.ok) return "skipped";

  const threadTs = str(msg.thread_ts);
  const rootTs = threadTs ?? ts;
  const thread = await prisma.commsThread.findUnique({
    where: { slackChannelId_slackRootTs: { slackChannelId: channel.id, slackRootTs: rootTs } },
    select: { id: true },
  });

  return processIntakeMessage({
    channel: "slack",
    channelKey: channel.channelId,
    messageKey: `${channel.channelId}:${ts}`,
    rootKey: `${channel.channelId}:${rootTs}`,
    isRoot: !threadTs || threadTs === ts,
    author: { kind: classifySlackAuthor(msg, elig.komainuTeamId, elig.mappedUsers), ref: str(msg.user) },
    text: sanitiseSlackMessage(str(msg.text) ?? ""),
    at: new Date(parseFloat(ts) * 1000),
    permalink: await permalink(channel.channelId, ts),
    client: elig.client,
    threadId: thread?.id ?? null,
  });
}

/** message_changed / message_deleted events (spec §9.2 rule 8). */
export async function handleSlackEditOrDelete(channel: Channel, event: SlackMessage): Promise<IntakeOutcome | "skipped"> {
  const elig = await eligibility(channel);
  if (!elig.ok) return "skipped";

  if (event.subtype === "message_changed") {
    const m = (event.message ?? {}) as SlackMessage;
    const ts = str(m.ts);
    if (!ts) return "skipped";
    const threadTs = str(m.thread_ts);
    const rootTs = threadTs ?? ts;
    return processIntakeEdit(
      "slack",
      `${channel.channelId}:${rootTs}`,
      !threadTs || threadTs === ts,
      sanitiseSlackMessage(str(m.text) ?? ""),
      new Date(),
      await permalink(channel.channelId, ts),
    );
  }

  if (event.subtype === "message_deleted") {
    const deletedTs = str(event.deleted_ts);
    const prev = (event.previous_message ?? {}) as SlackMessage;
    const rootTs = str(prev.thread_ts) ?? deletedTs;
    if (!rootTs) return "skipped";
    return processIntakeDelete("slack", `${channel.channelId}:${rootTs}`, new Date());
  }
  return "skipped";
}
