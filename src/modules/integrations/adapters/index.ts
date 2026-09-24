import { env } from "@/lib/env";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { getLastRateLimitRemaining, isCustodyConfigured } from "@/lib/integrations/custody-api/client";
import { getAtlassianRateLimitRemaining, isAtlassianConfigured } from "@/lib/integrations/atlassian/client";
import { getMailboxes, getTeamsChannels, isGraphConfigured } from "@/lib/integrations/graph/client";
import { isNotabeneConfigured } from "@/lib/integrations/notabene";
import { CUSTODY_HEARTBEATS } from "@/modules/integrations/custody/pollers";
import { JIRA_HEARTBEAT } from "@/modules/integrations/atlassian/sync";
import { SLACK_HEARTBEAT } from "@/modules/integrations/slack/events";
import { MAIL_EXPECTED_MINS, TEAMS_EXPECTED_MINS } from "@/modules/integrations/graph/sync";
import { computeHealth } from "@/modules/integrations/health";
import type { HeartbeatSpec, IntegrationAdapter } from "@/modules/integrations/types";

const always = async () => true;

function adapter(def: Omit<IntegrationAdapter, "getHealth">, rateLimit?: () => number | undefined): IntegrationAdapter {
  return { ...def, getHealth: () => computeHealth(def, { rateLimitRemaining: rateLimit?.() }) };
}

export const custodyAdapter = adapter(
  {
    source: "custody_api",
    label: "custody API (read-only)",
    breakerName: "custody_api",
    isConfigured: isCustodyConfigured,
    isEnabled: always,
    heartbeats: () => Object.values(CUSTODY_HEARTBEATS),
  },
  getLastRateLimitRemaining,
);

export const atlassianAdapter = adapter(
  {
    source: "atlassian",
    label: "Jira / JSM",
    breakerName: "atlassian",
    isConfigured: isAtlassianConfigured,
    isEnabled: always,
    heartbeats: () => [JIRA_HEARTBEAT],
  },
  getAtlassianRateLimitRemaining,
);

export const slackAdapter = adapter({
  source: "slack",
  label: "Slack",
  breakerName: "slack_channel_sync",
  isConfigured: () => Boolean(env("SLACK_BOT_TOKEN") && env("SLACK_SIGNING_SECRET")),
  isEnabled: always,
  heartbeats: () => [SLACK_HEARTBEAT],
});

export const graphMailAdapter = adapter({
  source: "graph_mail",
  label: "Microsoft 365 mail",
  breakerName: "graph",
  isConfigured: () => isGraphConfigured() && getMailboxes().length > 0,
  isEnabled: always,
  heartbeats: (): HeartbeatSpec[] => getMailboxes().map((m) => ({ source: `graph_mail.${m.label}`, expectedEveryMins: MAIL_EXPECTED_MINS })),
});

export const graphTeamsAdapter = adapter({
  source: "graph_teams",
  label: "Microsoft Teams",
  breakerName: "graph",
  isConfigured: () => isGraphConfigured() && getTeamsChannels().length > 0,
  isEnabled: always,
  heartbeats: (): HeartbeatSpec[] => getTeamsChannels().map((c) => ({ source: `graph_teams.${c.label}`, expectedEveryMins: TEAMS_EXPECTED_MINS })),
});

export const notabeneAdapter = adapter({
  source: "notabene",
  label: "Notabene (H11: off)",
  breakerName: "notabene",
  isConfigured: isNotabeneConfigured,
  isEnabled: () => isFeatureEnabled("integration.notabene.enabled"),
  heartbeats: () => [],
});
