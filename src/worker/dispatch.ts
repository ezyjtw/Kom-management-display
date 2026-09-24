/**
 * Job handler map shared by the always-on worker and the admin-only
 * /api/jobs `process_next` action.
 */

import { prisma } from "@/lib/prisma";
import type { JobType } from "@/lib/background-jobs";

type Payload = Record<string, unknown>;
type Handler = (payload: Payload) => Promise<unknown>;

function str(payload: Payload, key: string): string {
  const v = payload[key];
  return typeof v === "string" ? v : "";
}

type KomainuJob =
  | "komainu_poll_requests" | "komainu_poll_transactions" | "komainu_poll_collateral"
  | "komainu_poll_audit_logs" | "komainu_poll_eod_balances" | "komainu_poll_staking" | "komainu_poll_stakes";

function komainuHandlers(): Record<KomainuJob, Handler> {
  const run = (fn: (p: typeof import("@/modules/integrations/komainu/pollers")) => Promise<unknown>): Handler => async () => {
    const { isKomainuConfigured } = await import("@/lib/integrations/komainu-api/client");
    if (!isKomainuConfigured()) return { skipped: true, reason: "Komainu API not configured" };
    return fn(await import("@/modules/integrations/komainu/pollers"));
  };
  return {
    komainu_poll_requests: run((p) => p.pollRequests()),
    komainu_poll_transactions: run((p) => p.pollTransactions()),
    komainu_poll_collateral: run((p) => p.pollCollateral()),
    komainu_poll_audit_logs: run((p) => p.pollAuditLogs()),
    komainu_poll_eod_balances: run((p) => p.pollEodBalances()),
    komainu_poll_staking: run((p) => p.pollStakingRewards()),
    komainu_poll_stakes: run((p) => p.pollStakes()),
  };
}

export const JOB_HANDLERS: Record<JobType, Handler> = {
  async sync_jira() {
    const { isAtlassianConfigured } = await import("@/lib/integrations/atlassian/client");
    if (!isAtlassianConfigured()) return { skipped: true, reason: "Atlassian not configured" };
    const { syncJiraIssues } = await import("@/modules/integrations/atlassian/sync");
    return syncJiraIssues();
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

  async check_confirmations() {
    const { checkExpiredConfirmations, syncConfirmationsWithSource } = await import(
      "@/lib/transaction-confirmation"
    );
    const closedInSource = await syncConfirmationsWithSource();
    const expired = await checkExpiredConfirmations();
    return { expiredConfirmations: expired, closedInSource };
  },

  async data_retention() {
    const { getSetting } = await import("@/modules/settings/settings");
    if (!(await getSetting("retention.enabled"))) {
      // Evidence that the control ran and why it deleted nothing (the run is kept in BackgroundJobRun).
      return { skipped: true, reason: "Retention periods not confirmed (CONFIRM-RETENTION); retention.enabled is off." };
    }
    const { enforceRetentionPolicies } = await import("@/lib/data-retention");
    const results = await enforceRetentionPolicies();
    const failed = results.filter((r) => r.error);
    // No false green: a partial run fails the job, so it retries and, if it keeps failing, is dead-lettered.
    if (failed.length) throw new Error(`Retention failed for ${failed.map((r) => r.policy).join(", ")}`);
    return { deleted: results.map((r) => ({ policy: r.policy, deleted: r.deletedCount, cutoff: r.cutoffDate })) };
  },
  async cleanup_sessions() {
    const { cleanupExpiredSessions } = await import("@/lib/session-revocation");
    const { prunePollCycles } = await import("@/modules/integrations/poll-cycles");
    const { pruneJobRuns } = await import("@/lib/background-jobs");
    const { pruneRateLimitBuckets } = await import("@/lib/api/shared-rate-limit");
    const { pruneIdempotencyKeys } = await import("@/lib/idempotency");
    return { cleanedSessions: await cleanupExpiredSessions(), prunedPollCycles: await prunePollCycles(), prunedJobRuns: await pruneJobRuns(), prunedRateLimitBuckets: await pruneRateLimitBuckets(), prunedIdempotencyKeys: await pruneIdempotencyKeys() };
  },

  /** Spec §6.1: every registered channel once per 5-minute cycle, 24/7 (history from the cursor, then replies). */
  async sync_slack() {
    const { pollAllSlackChannels } = await import("@/modules/slack/services/slack-poller");
    return pollAllSlackChannels();
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
    const { isFeatureEnabled } = await import("@/lib/feature-flags");
    if (!(await isFeatureEnabled("module.status_pages"))) return { skipped: true, reason: "module.status_pages is off" };
    const { pollAllStatusPages } = await import("@/lib/status-page-poller");
    await pollAllStatusPages();
    return { polled: true };
  },

  async slack_event(payload) {
    const { processSlackEvent } = await import("@/modules/integrations/slack/events");
    return processSlackEvent(payload);
  },

  ...komainuHandlers(),

  /** Spec §6.1: every configured shared mailbox every 5 minutes, 24/7, via Graph delta queries. */
  async sync_mail() {
    const { isGraphConfigured } = await import("@/lib/integrations/graph/client");
    if (!isGraphConfigured()) return { skipped: true, reason: "Graph not configured" };
    const { syncGraphMail } = await import("@/modules/integrations/graph/sync");
    return syncGraphMail();
  },

  async graph_teams_sync() {
    const { isGraphConfigured } = await import("@/lib/integrations/graph/client");
    if (!isGraphConfigured()) return { skipped: true, reason: "Graph not configured" };
    const { syncGraphTeams } = await import("@/modules/integrations/graph/sync");
    return syncGraphTeams();
  },

  async gx_sprint_intake() {
    const { runScheduledIntake } = await import("@/modules/gx-sprints/intake");
    return runScheduledIntake();
  },

  async morning_handover() {
    const { runMorningHandover } = await import("@/modules/morning/handover");
    return runMorningHandover();
  },

  async report_unticketed() {
    const { runUnticketedReport } = await import("@/modules/work-items/ticket-jobs");
    return runUnticketedReport();
  },

  async reconcile_tickets() {
    const { reconcileTickets } = await import("@/modules/work-items/ticket-jobs");
    return reconcileTickets();
  },

  async iai_overdue() {
    const { checkOverdueIaiDrafts } = await import("@/modules/iai/overdue-job");
    return checkOverdueIaiDrafts();
  },

  async evaluate_alerts() {
    const { runAlertEngine } = await import("@/modules/alerting/engine");
    return runAlertEngine();
  },

  async alert_digest() {
    const { runAlertDigest } = await import("@/modules/alerting/routing");
    return runAlertDigest();
  },

  async poll_risk_signals() {
    const { pollRiskSignals } = await import("@/modules/risk/signal-source");
    return pollRiskSignals();
  },

  async generate_daily_checks() {
    const { generateDailyItems } = await import("@/modules/daily-checks/schedule");
    return generateDailyItems();
  },

  async collect_check_evidence() {
    const { collectEvidenceForOpenItems } = await import("@/modules/daily-checks/collectors");
    return collectEvidenceForOpenItems();
  },

  async mtd_autoclose() {
    const { autoCloseDailyMtdTickets } = await import("@/modules/daily-checks/mtd");
    return autoCloseDailyMtdTickets();
  },

  async poll_client_ticket_comments() {
    const { ingestPortalComments } = await import("@/modules/client-incidents/portal-comments");
    return ingestPortalComments();
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
