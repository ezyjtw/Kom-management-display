/**
 * Email and Teams client intake (spec §9.3), same rules as Slack.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { GraphChannelMessage, GraphMessage } from "@/lib/integrations/graph/client";
import { getSettings } from "@/modules/settings/settings";
import { findRequestForRoot, processIntakeMessage, type IntakeOutcome } from "@/modules/intake/intake-core";

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

async function clientForDomain(domain: string) {
  const channel = await prisma.clientChannel.findUnique({
    where: { kind_ref: { kind: "email_domain", ref: domain } },
    select: { client: { select: { id: true, displayName: true, jsmOrganizationId: true, isActive: true } } },
  });
  return channel?.client?.isActive ? channel.client : null;
}

/** Custody inbox message. Unknown external domains open a request tagged client-unknown (for triage). */
export async function handleEmailIntake(mailboxLabel: string, msg: GraphMessage, threadId: string | null): Promise<IntakeOutcome | "skipped"> {
  const cfg = await getSettings(["intake.email.enabled", "intake.internalEmailDomains"] as const);
  if (!cfg["intake.email.enabled"]) return "skipped";
  if (cfg["intake.internalEmailDomains"].length === 0) {
    logger.error("Email intake is enabled but intake.internalEmailDomains is empty");
    return "not_configured";
  }

  const from = msg.from?.emailAddress?.address?.toLowerCase() ?? "";
  const domain = from.split("@")[1] ?? "";
  const staff = cfg["intake.internalEmailDomains"].includes(domain);
  const rootKey = msg.conversationId ?? msg.id;
  const hasRequest = (await findRequestForRoot("email", rootKey)) !== null;

  return processIntakeMessage({
    channel: "email",
    channelKey: mailboxLabel,
    messageKey: `email:${msg.internetMessageId ?? msg.id}`,
    rootKey,
    isRoot: !hasRequest,
    author: { kind: staff ? "staff" : "external", ref: from || null },
    text: [msg.subject, msg.bodyPreview].filter(Boolean).join("\n\n"),
    at: msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date(),
    permalink: null,
    client: staff ? null : await clientForDomain(domain),
    threadId,
  });
}

/**
 * Teams channel mapped to a client (ClientChannel kind "teams", ref = channel id).
 * Only root posts are handled; thread replies need the /replies endpoint.
 * TODO(CONFIRM-TEAMS-FORMAT): confirm how the author's tenant is exposed.
 */
export async function handleTeamsIntake(channelId: string, msg: GraphChannelMessage): Promise<IntakeOutcome | "skipped"> {
  const cfg = await getSettings(["intake.teams.enabled", "intake.teams.custodyTenantId"] as const);
  if (!cfg["intake.teams.enabled"]) return "skipped";
  if (!cfg["intake.teams.custodyTenantId"]) {
    logger.error("Teams intake is enabled but intake.teams.custodyTenantId is not set");
    return "not_configured";
  }
  const mapping = await prisma.clientChannel.findUnique({
    where: { kind_ref: { kind: "teams", ref: channelId } },
    select: { client: { select: { id: true, displayName: true, jsmOrganizationId: true, isActive: true } } },
  });
  if (!mapping?.client?.isActive) return "skipped";

  const user = msg.from?.user as ({ id?: string; tenantId?: string } | null | undefined);
  const kind = msg.from?.application ? "bot" : user?.tenantId === cfg["intake.teams.custodyTenantId"] ? "staff" : "external";

  return processIntakeMessage({
    channel: "teams",
    channelKey: channelId,
    messageKey: `teams:${channelId}:${msg.id}`,
    rootKey: `${channelId}:${msg.id}`,
    isRoot: true,
    author: { kind, ref: user?.id ?? null },
    text: stripHtml(msg.body?.content ?? ""),
    at: msg.createdDateTime ? new Date(msg.createdDateTime) : new Date(),
    client: mapping.client,
  });
}
