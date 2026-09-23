/**
 * Job handler map shared by the always-on worker and the admin-only
 * /api/jobs `process_next` action.
 */

import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import type { JobType } from "@/lib/background-jobs";

type Payload = Record<string, unknown>;
type Handler = (payload: Payload) => Promise<unknown>;

function str(payload: Payload, key: string): string {
  const v = payload[key];
  return typeof v === "string" ? v : "";
}

export const JOB_HANDLERS: Record<JobType, Handler> = {
  async sync_slack(payload) {
    const { syncSlackChannel } = await import("@/lib/integrations/slack");
    const channelId = str(payload, "channelId") || env("SLACK_OPS_CHANNEL_ID") || "";
    if (!channelId) return { skipped: true, reason: "No channel ID configured" };
    return syncSlackChannel(channelId);
  },

  async sync_email() {
    const { syncEmailInbox } = await import("@/lib/integrations/email");
    return syncEmailInbox();
  },

  async sync_jira(payload) {
    const { syncJiraProject } = await import("@/lib/integrations/jira");
    const projectKey = str(payload, "projectKey") || env("JIRA_PROJECT_KEY") || "";
    if (!projectKey) return { skipped: true, reason: "No Jira project key configured" };
    return syncJiraProject(projectKey);
  },

  async check_sla() {
    const now = new Date();
    const breached = await prisma.commsThread.count({
      where: {
        status: { notIn: ["Done", "Closed"] },
        OR: [
          { ttoDeadline: { lt: now } },
          { ttfaDeadline: { lt: now } },
          { tslaDeadline: { lt: now } },
        ],
      },
    });
    return { breachedThreads: breached };
  },

  async check_staking() {
    const overdue = await prisma.stakingWallet.count({
      where: { status: "active", expectedNextRewardAt: { lt: new Date() } },
    });
    return { overdueRewards: overdue };
  },

  async poll_custody() {
    const { isKomainuConfigured, fetchPendingTransactions } = await import(
      "@/lib/integrations/komainu-api/client"
    );
    if (!isKomainuConfigured()) return { skipped: true, reason: "Komainu API not configured" };
    const result = await fetchPendingTransactions();
    return { transactionsPolled: result.data.length };
  },

  async check_confirmations() {
    const { checkExpiredConfirmations, syncConfirmationsWithSource } = await import(
      "@/lib/transaction-confirmation"
    );
    const closedInSource = await syncConfirmationsWithSource();
    const expired = await checkExpiredConfirmations();
    return { expiredConfirmations: expired, closedInSource };
  },

  async cleanup_sessions() {
    const { cleanupExpiredSessions } = await import("@/lib/session-revocation");
    return { cleanedSessions: await cleanupExpiredSessions() };
  },

  async sync_slack_channel(payload) {
    const { syncChannelMessages } = await import("@/modules/slack/services/slack-ingestion-service");
    const channelId = str(payload, "channelId");
    if (channelId) return syncChannelMessages(channelId);

    const { findAllActive } = await import("@/modules/slack/repositories/slack-channel-repository");
    const channels = await findAllActive();
    const results = [];
    for (const channel of channels) results.push(await syncChannelMessages(channel.channelId));
    return { channelsSynced: results.length };
  },

  async sync_slack_replies(payload) {
    const { syncThreadReplies } = await import("@/modules/slack/services/slack-ingestion-service");
    const channelId = str(payload, "channelId");
    const threadTs = str(payload, "threadTs");
    if (!channelId || !threadTs) throw new Error("sync_slack_replies needs channelId and threadTs");
    return syncThreadReplies(channelId, threadTs);
  },

  async classify_thread(payload) {
    const { classifyThread } = await import("@/lib/ai-thread-classifier");
    const threadId = str(payload, "threadId");
    if (!threadId) throw new Error("classify_thread needs threadId");
    return { classified: (await classifyThread(threadId)) !== null };
  },

  async draft_client_comms(payload) {
    const { draftClientComms } = await import("@/lib/ai-comms-drafter");
    const impactRecordId = str(payload, "impactRecordId");
    if (!impactRecordId) throw new Error("draft_client_comms needs impactRecordId");

    const record = await prisma.clientImpactRecord.findUnique({
      where: { id: impactRecordId },
      include: { incident: true },
    });
    if (!record) return { skipped: true, reason: "Impact record not found" };

    const affected = Array.isArray(record.affectedServices)
      ? record.affectedServices.filter((s): s is string => typeof s === "string")
      : [];
    const draftId = await draftClientComms(
      {
        id: record.id,
        clientName: record.clientName,
        affectedServices: affected,
        impactStatus: record.impactStatus,
      },
      {
        id: record.incident.id,
        title: record.incident.title,
        provider: record.incident.provider,
        severity: record.incident.severity,
        description: record.incident.description,
        status: record.incident.status,
      },
    );
    return { draftId };
  },

  async poll_status_pages() {
    const { pollAllStatusPages } = await import("@/lib/status-page-poller");
    await pollAllStatusPages();
    return { polled: true };
  },

  async score_vendor_reliability() {
    const { computeAllVendorScores } = await import("@/lib/vendor-reliability");
    const now = new Date();
    const quarterStart = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));
    const periodStart = new Date(Date.UTC(quarterStart.getUTCFullYear(), quarterStart.getUTCMonth() - 3, 1));
    await computeAllVendorScores(periodStart, quarterStart);
    return { periodStart, periodEnd: quarterStart };
  },
};

export function isKnownJobType(type: string): type is JobType {
  return Object.prototype.hasOwnProperty.call(JOB_HANDLERS, type);
}

/** Throws for unknown types so the job is retried/dead-lettered rather than silently "completed". */
export async function dispatchJob(type: string, payload: unknown): Promise<unknown> {
  if (!isKnownJobType(type)) throw new Error(`Unknown job type: ${type}`);
  const safePayload = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Payload)
    : {};
  return JOB_HANDLERS[type](safePayload);
}
