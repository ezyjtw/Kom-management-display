/**
 * Inbound Jira/JSM sync (spec §8.2): every 2 minutes, issues updated in the
 * last 5 minutes in enabled projects become WorkItems (not CommsThreads).
 * Idempotent on (key, updated) via JiraIssueEvent.
 */

import { Prisma, type WorkItemKind, type WorkItemState } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { browseUrl, searchIssues, type JiraIssue } from "@/lib/integrations/atlassian/client";
import { recordHeartbeat } from "@/modules/integrations/heartbeat";
import { notifyOnAssign } from "@/modules/notifications/on-assign";

export const JIRA_HEARTBEAT = { source: "atlassian.issues", expectedEveryMins: 2 };

const WORK_ITEM_KINDS = new Set<string>([
  "client_request", "alert", "daily_check_exception", "mtd_break", "oes_settlement", "fab_instruction",
  "kps_case", "vendor_ticket", "travel_rule_case", "screening_case", "scam_dust_case", "coin_review",
  "staking_exception", "nft_review", "report_task", "incident", "rca", "internal_task",
]);

/** Jira status category -> WorkItem state. Closure in KOMmand Centre still needs a write-up (Phase 5). */
export function stateFromIssue(issue: JiraIssue): WorkItemState {
  const category = issue.fields.status?.statusCategory?.key;
  if (category === "done") return "resolved";
  if (category === "indeterminate") return issue.fields.assignee ? "owned" : "open";
  return "open";
}

export function buildJql(projectKeys: string[], window = "-5m"): string {
  const keys = projectKeys.filter((k) => /^[A-Z][A-Z0-9_]+$/.test(k));
  return `project in (${keys.join(", ")}) AND updated >= ${window} ORDER BY updated ASC`;
}

async function ownerFor(issue: JiraIssue): Promise<string | null> {
  const email = issue.fields.assignee?.emailAddress;
  if (!email) return null;
  const emp = await prisma.employee.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, active: true },
    select: { id: true },
  });
  return emp?.id ?? null;
}

export async function applyIssue(issue: JiraIssue, cfg: { kind: string; defaultWorkItemKind: string; defaultTeam: string; defaultTaskCode: string }): Promise<"skipped" | "created" | "updated"> {
  const updated = issue.fields.updated ? new Date(issue.fields.updated) : new Date();
  const system = cfg.kind === "jsm" ? "jsm" : "jira";

  const seen = await prisma.jiraIssueEvent.findUnique({
    where: { system_key_updated: { system, key: issue.key, updated } },
  });
  if (seen) return "skipped";

  const state = stateFromIssue(issue);
  const ownerEmployeeId = await ownerFor(issue);
  const existing =
    (await prisma.workItem.findFirst({ where: { ticketKey: issue.key } })) ??
    (await prisma.workItem.findUnique({ where: { sourceSystem_sourceId: { sourceSystem: system, sourceId: issue.key } } }));

  let workItemId: string;
  let outcome: "created" | "updated";
  if (existing) {
    // A WorkItem closed with a write-up in KOMmand Centre stays closed.
    const nextState = existing.state === "closed" ? "closed" : state;
    const updatedItem = await prisma.workItem.update({
      where: { id: existing.id },
      data: {
        title: issue.fields.summary ?? existing.title,
        state: nextState,
        ownerEmployeeId: ownerEmployeeId ?? existing.ownerEmployeeId,
        ownedAt: existing.ownedAt ?? (ownerEmployeeId ? updated : null),
        resolvedAt: nextState === "resolved" ? existing.resolvedAt ?? updated : existing.resolvedAt,
        ticketSystem: existing.ticketSystem ?? system,
        ticketKey: existing.ticketKey ?? issue.key,
        ticketUrl: existing.ticketUrl ?? browseUrl(issue.key),
      },
    });
    workItemId = updatedItem.id;
    outcome = "updated";
  } else {
    const kind = (WORK_ITEM_KINDS.has(cfg.defaultWorkItemKind) ? cfg.defaultWorkItemKind : "internal_task") as WorkItemKind;
    const created = await prisma.workItem.create({
      data: {
        kind,
        title: issue.fields.summary ?? issue.key,
        team: cfg.defaultTeam,
        taskCode: cfg.defaultTaskCode || `JIRA-${issue.fields.project?.key ?? ""}`,
        state,
        ownerEmployeeId,
        ownedAt: ownerEmployeeId ? updated : null,
        resolvedAt: state === "resolved" ? updated : null,
        sourceSystem: system,
        sourceId: issue.key,
        ticketSystem: system,
        ticketKey: issue.key,
        ticketUrl: browseUrl(issue.key),
        clockStartedAt: issue.fields.created ? new Date(issue.fields.created) : updated,
        metadata: {
          jiraStatus: issue.fields.status?.name ?? null,
          jiraPriority: issue.fields.priority?.name ?? null,
          issueType: issue.fields.issuetype?.name ?? null,
        } as Prisma.InputJsonValue,
      },
    });
    workItemId = created.id;
    outcome = "created";
  }

  // Spec §12 TASK-OTC: notify on assignment, per user preference.
  if (ownerEmployeeId && ownerEmployeeId !== existing?.ownerEmployeeId) {
    await notifyOnAssign({ employeeId: ownerEmployeeId, ticketKey: issue.key, title: issue.fields.summary ?? issue.key, url: browseUrl(issue.key) }).catch((error) =>
      logger.warn("Assignment notification failed", { key: issue.key, error: error instanceof Error ? error.message : String(error) }),
    );
  }

  const url = browseUrl(issue.key);
  if (url) {
    await prisma.ticketLink.upsert({
      where: { system_key_workItemId: { system, key: issue.key, workItemId } },
      update: {},
      create: { system, key: issue.key, url, workItemId, role: "primary" },
    });
  }

  await prisma.jiraIssueEvent.create({
    data: {
      system,
      key: issue.key,
      updated,
      status: issue.fields.status?.name ?? "",
      assignee: issue.fields.assignee?.accountId ?? null,
      workItemId,
    },
  });
  return outcome;
}

export async function syncJiraIssues(window = "-5m") {
  const configs = await prisma.jiraProjectConfig.findMany({ where: { enabled: true, syncInbound: true } });
  if (configs.length === 0) return { skipped: true, reason: "No Jira projects enabled for inbound sync" };

  const byProject = new Map(configs.map((c) => [c.key, c]));
  const issues = await searchIssues(buildJql(configs.map((c) => c.key), window));
  const counts = { created: 0, updated: 0, skipped: 0 };
  for (const issue of issues) {
    const cfg = byProject.get(issue.fields.project?.key ?? issue.key.split("-")[0]);
    if (!cfg) continue;
    try {
      counts[await applyIssue(issue, cfg)]++;
    } catch (error) {
      logger.error("Jira issue sync failed", { key: issue.key, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const newest = issues.reduce<Date | null>((m, i) => {
    const t = i.fields.updated ? new Date(i.fields.updated) : null;
    return t && (!m || t > m) ? t : m;
  }, null);
  await recordHeartbeat(JIRA_HEARTBEAT.source, { count: issues.length, newestRecordAt: newest, expectedEveryMins: JIRA_HEARTBEAT.expectedEveryMins });
  return { issues: issues.length, ...counts };
}
