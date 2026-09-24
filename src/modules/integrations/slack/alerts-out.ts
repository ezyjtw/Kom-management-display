/**
 * Outbound alert posts (spec §8.4). Each message carries the rule code, the
 * WorkItem link and the ticket key. The ONLY buttons are links: "Open in
 * KOMmand Centre" and "Open ticket". No interactive approve/reject, ever (H1).
 */

import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { getSlackClient } from "@/lib/integrations/slack";

export interface AlertPostInput {
  ruleCode: string;
  severity: string;
  message: string;
  workItemId?: string | null;
  ticketKey?: string | null;
  ticketUrl?: string | null;
}

type LinkButton = { type: "button"; text: { type: "plain_text"; text: string }; url: string };

export function buildAlertBlocks(input: AlertPostInput, appUrl: string) {
  const buttons: LinkButton[] = [];
  if (input.workItemId) {
    buttons.push({ type: "button", text: { type: "plain_text", text: "Open in KOMmand Centre" }, url: `${appUrl.replace(/\/+$/, "")}/work/${input.workItemId}` });
  }
  if (input.ticketUrl) {
    buttons.push({ type: "button", text: { type: "plain_text", text: "Open ticket" }, url: input.ticketUrl });
  }
  const text = `*${input.ruleCode}* (${input.severity}) ${input.message}${input.ticketKey ? `\nTicket: ${input.ticketKey}` : ""}`;
  return {
    text: `${input.ruleCode}: ${input.message}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text } },
      ...(buttons.length ? [{ type: "actions", elements: buttons }] : []),
    ],
  };
}

/** Post to the configured alerts_out channel. Returns false when none is configured. */
export async function postAlertToSlack(input: AlertPostInput): Promise<boolean> {
  const client = getSlackClient();
  const channel = await prisma.slackChannel.findFirst({ where: { purpose: "alerts_out", isActive: true } });
  if (!client || !channel) return false;
  const { text, blocks } = buildAlertBlocks(input, env("NEXTAUTH_URL"));
  await client.chat.postMessage({ channel: channel.channelId, text, blocks });
  return true;
}
