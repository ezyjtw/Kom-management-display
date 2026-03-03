import { prisma } from "@/lib/prisma";
import { computeTtoDeadline } from "@/lib/sla";
import { normaliseSubject, deriveAutoPriority } from "@/lib/thread-utils";
import type { ThreadPriority } from "@/types";

// ---------------------------------------------------------------------------
// Jira configuration
// ---------------------------------------------------------------------------

interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

function getJiraConfig(): JiraConfig | null {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !email || !apiToken) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), email, apiToken };
}

// ---------------------------------------------------------------------------
// Jira REST helpers
// ---------------------------------------------------------------------------

interface JiraIssue {
  key: string; // e.g. "OPS-1234"
  id: string;
  self: string;
  fields: {
    summary: string;
    description?: string | null;
    status: { name: string };
    priority?: { name: string } | null;
    issuetype: { name: string };
    assignee?: { displayName: string; emailAddress: string } | null;
    reporter?: { displayName: string; emailAddress: string } | null;
    project: { key: string; name: string };
    created: string;
    updated: string;
    labels?: string[];
  };
}

async function jiraFetch<T>(config: JiraConfig, path: string): Promise<T> {
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  const res = await fetch(`${config.baseUrl}/rest/api/3${path}`, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Jira API ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Priority mapping: Jira issue type / priority → CommsThread priority
// ---------------------------------------------------------------------------

/**
 * Map a Jira issue to an ops priority.
 * Uses the Jira priority field first, then falls back to issue-type heuristics,
 * and finally tries keyword auto-detection on the summary.
 */
function mapJiraPriority(issue: JiraIssue): ThreadPriority {
  const jiraPriority = issue.fields.priority?.name?.toLowerCase() ?? "";
  const issueType = issue.fields.issuetype.name.toLowerCase();

  // Direct Jira priority mapping
  if (["highest", "blocker"].includes(jiraPriority)) return "P0";
  if (["high", "critical"].includes(jiraPriority)) return "P1";
  if (["medium"].includes(jiraPriority)) return "P2";
  if (["low", "lowest", "trivial"].includes(jiraPriority)) return "P3";

  // Issue-type heuristic
  if (["incident", "outage"].includes(issueType)) return "P0";
  if (["bug"].includes(issueType)) return "P1";
  if (["change", "task"].includes(issueType)) return "P2";
  if (["sub-task", "subtask"].includes(issueType)) return "P3";

  // Fall back to keyword detection
  return (
    deriveAutoPriority({ subject: issue.fields.summary }) ?? "P2"
  );
}

// ---------------------------------------------------------------------------
// Sync logic
// ---------------------------------------------------------------------------

/**
 * Sync Jira tickets into CommsThreads.
 *
 * @param projectKey - Jira project key to sync (e.g. "OPS")
 * @param queue      - Ops queue to file new threads into
 * @param jql        - Optional custom JQL override
 */
export async function syncJiraProject(
  projectKey: string,
  queue: string = "Transaction Operations",
  jql?: string,
) {
  const config = getJiraConfig();
  if (!config) {
    throw new Error("Jira not configured: JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN are required");
  }

  // Default JQL: open issues updated in the last 7 days
  const defaultJql = `project = "${projectKey}" AND statusCategory != Done AND updated >= -7d ORDER BY updated DESC`;
  const query = jql || defaultJql;
  const encoded = encodeURIComponent(query);

  const searchResult = await jiraFetch<{
    issues: JiraIssue[];
    total: number;
  }>(config, `/search?jql=${encoded}&maxResults=100&fields=summary,description,status,priority,issuetype,assignee,reporter,project,created,updated,labels`);

  const synced: string[] = [];

  for (const issue of searchResult.issues) {
    const sourceRef = `jira-${issue.key}`;

    // Check if thread already exists
    const existing = await prisma.commsThread.findFirst({
      where: { sourceThreadRef: sourceRef },
    });

    if (existing) {
      // Update subject, priority & lastMessageAt if the issue was updated
      const updatedAt = new Date(issue.fields.updated);
      const data: Record<string, unknown> = {};

      if (updatedAt > existing.lastMessageAt) {
        data.lastMessageAt = updatedAt;
      }
      // Re-derive subject in case it changed in Jira
      const freshSubject = normaliseSubject(issue.fields.summary);
      if (freshSubject !== existing.subject) {
        data.subject = freshSubject;
      }

      if (Object.keys(data).length > 0) {
        await prisma.commsThread.update({
          where: { id: existing.id },
          data,
        });
      }

      synced.push(existing.id);
      continue;
    }

    // --- Create new thread ---
    const priority = mapJiraPriority(issue);
    const subject = normaliseSubject(issue.fields.summary);
    const createdAt = new Date(issue.fields.created);

    const participants: string[] = [];
    if (issue.fields.assignee?.emailAddress) {
      participants.push(issue.fields.assignee.emailAddress);
    }
    if (issue.fields.reporter?.emailAddress) {
      participants.push(issue.fields.reporter.emailAddress);
    }

    const jiraUrl = `${config.baseUrl}/browse/${issue.key}`;

    const thread = await prisma.commsThread.create({
      data: {
        source: "jira",
        sourceThreadRef: sourceRef,
        participants: JSON.stringify([...new Set(participants)]),
        clientOrPartnerTag: issue.fields.project.key,
        subject,
        priority,
        status: "Unassigned",
        queue,
        lastMessageAt: new Date(issue.fields.updated),
        ttoDeadline: computeTtoDeadline(createdAt, priority as ThreadPriority),
        linkedRecords: JSON.stringify([
          { type: "jira", id: issue.key, label: `${issue.key}: ${issue.fields.summary}`.substring(0, 120), url: jiraUrl },
        ]),
      },
    });

    // Store the description as the initial "message"
    const descText =
      typeof issue.fields.description === "string"
        ? issue.fields.description
        : issue.fields.description
          ? JSON.stringify(issue.fields.description).substring(0, 2000)
          : `[${issue.fields.issuetype.name}] ${issue.fields.summary}`;

    await prisma.commsMessage.create({
      data: {
        threadId: thread.id,
        authorName: issue.fields.reporter?.displayName || "Jira",
        authorType: "external",
        bodySnippet: descText.substring(0, 2000),
        bodyLink: jiraUrl,
        timestamp: createdAt,
      },
    });

    synced.push(thread.id);
  }

  return {
    project: projectKey,
    totalIssues: searchResult.total,
    threadsSynced: synced.length,
  };
}
