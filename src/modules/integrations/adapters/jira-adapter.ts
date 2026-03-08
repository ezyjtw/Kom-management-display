/**
 * Jira integration adapter.
 *
 * Wraps the existing Jira REST helpers from src/lib/integrations/jira.ts
 * behind the IntegrationAdapter interface with proper retry, rate-limit
 * awareness, and health tracking.
 */

import { logger } from "@/lib/logger";
import type {
  IntegrationAdapter,
  IntegrationHealth,
  NormalizedEvent,
  NormalizedPayload,
} from "@/modules/integrations/types";

// ---------------------------------------------------------------------------
// Jira API types (mirrors src/lib/integrations/jira.ts)
// ---------------------------------------------------------------------------

interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

interface JiraIssue {
  key: string;
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

interface JiraSearchResult {
  issues: JiraIssue[];
  total: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getJiraConfig(): JiraConfig | null {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !email || !apiToken) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), email, apiToken };
}

/**
 * Fetch with retry + exponential backoff.
 * Respects Retry-After header when rate-limited (HTTP 429).
 */
async function jiraFetchWithRetry<T>(
  config: JiraConfig,
  path: string,
  maxRetries = 3,
): Promise<{ data: T; rateLimitRemaining?: number }> {
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${config.baseUrl}/rest/api/3${path}`, {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
        },
      });

      // Rate-limit handling
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10);
        const delay = retryAfter * 1000;
        logger.warn("Jira rate limited, backing off", { retryAfter, attempt });
        await sleep(delay);
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => res.statusText);
        throw new Error(`Jira API ${res.status}: ${body}`);
      }

      const rateLimitRemaining = res.headers.get("X-RateLimit-Remaining")
        ? parseInt(res.headers.get("X-RateLimit-Remaining")!, 10)
        : undefined;

      const data = (await res.json()) as T;
      return { data, rateLimitRemaining };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        logger.warn("Jira fetch retry", { attempt, backoff, error: lastError.message });
        await sleep(backoff);
      }
    }
  }

  throw lastError ?? new Error("Jira fetch failed after retries");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapPriority(issue: JiraIssue): string {
  const p = issue.fields.priority?.name?.toLowerCase() ?? "";
  if (["highest", "blocker"].includes(p)) return "P0";
  if (["high", "critical"].includes(p)) return "P1";
  if (["medium"].includes(p)) return "P2";
  if (["low", "lowest", "trivial"].includes(p)) return "P3";
  return "P2";
}

function mapStatus(jiraStatus: string): string {
  const lower = jiraStatus.toLowerCase();
  if (["to do", "open", "backlog", "new"].includes(lower)) return "open";
  if (["in progress", "in review", "in development"].includes(lower)) return "in_progress";
  if (["done", "closed", "resolved"].includes(lower)) return "resolved";
  return lower;
}

function mapEventType(issue: JiraIssue): NormalizedEvent["eventType"] {
  const status = issue.fields.status.name.toLowerCase();
  if (["done", "closed"].includes(status)) return "closed";
  if (["resolved"].includes(status)) return "resolved";
  return "updated";
}

function mapIssueToEvent(issue: JiraIssue, config: JiraConfig): NormalizedEvent {
  const participants: NormalizedPayload["participants"] = [];
  if (issue.fields.assignee) {
    participants.push({
      name: issue.fields.assignee.displayName,
      email: issue.fields.assignee.emailAddress,
      role: "assignee",
    });
  }
  if (issue.fields.reporter) {
    participants.push({
      name: issue.fields.reporter.displayName,
      email: issue.fields.reporter.emailAddress,
      role: "reporter",
    });
  }

  return {
    id: `jira-${issue.key}-${issue.fields.updated}`,
    sourceSystem: "jira",
    sourceId: issue.key,
    entityType: "ticket",
    eventType: mapEventType(issue),
    occurredAt: new Date(issue.fields.updated),
    receivedAt: new Date(),
    payload: {
      subject: issue.fields.summary,
      body:
        typeof issue.fields.description === "string"
          ? issue.fields.description
          : issue.fields.description
            ? JSON.stringify(issue.fields.description).substring(0, 2000)
            : undefined,
      status: mapStatus(issue.fields.status.name),
      priority: mapPriority(issue),
      actor: issue.fields.reporter
        ? {
            name: issue.fields.reporter.displayName,
            email: issue.fields.reporter.emailAddress,
          }
        : undefined,
      participants,
      metadata: {
        project: issue.fields.project.key,
        projectName: issue.fields.project.name,
        issueType: issue.fields.issuetype.name,
        labels: issue.fields.labels ?? [],
        jiraUrl: `${config.baseUrl}/browse/${issue.key}`,
      },
    },
    rawPayload: issue as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class JiraAdapter implements IntegrationAdapter {
  readonly source = "jira" as const;

  private lastSuccessfulSync: Date | null = null;
  private lastFailure: Date | null = null;
  private lastFailureMessage?: string;
  private failureCount = 0;
  private rateLimitRemaining?: number;

  isConfigured(): boolean {
    return getJiraConfig() !== null;
  }

  async sync(opts?: Record<string, unknown>): Promise<NormalizedEvent[]> {
    const config = getJiraConfig();
    if (!config) {
      logger.warn("Jira adapter not configured, skipping sync");
      return [];
    }

    const projectKey = (opts?.projectKey as string) ?? undefined;
    const jql =
      (opts?.jql as string) ??
      (projectKey
        ? `project = "${projectKey}" AND statusCategory != Done AND updated >= -7d ORDER BY updated DESC`
        : `statusCategory != Done AND updated >= -7d ORDER BY updated DESC`);

    const encoded = encodeURIComponent(jql);
    const maxResults = (opts?.maxResults as number) ?? 100;

    try {
      logger.info("Jira sync starting", { projectKey, jql });

      const { data, rateLimitRemaining } = await jiraFetchWithRetry<JiraSearchResult>(
        config,
        `/search?jql=${encoded}&maxResults=${maxResults}&fields=summary,description,status,priority,issuetype,assignee,reporter,project,created,updated,labels`,
      );

      this.rateLimitRemaining = rateLimitRemaining;

      const events: NormalizedEvent[] = data.issues.map((issue) =>
        mapIssueToEvent(issue, config),
      );

      this.lastSuccessfulSync = new Date();
      this.failureCount = 0;
      logger.info("Jira sync completed", {
        total: data.total,
        fetched: events.length,
      });

      return events;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastFailure = new Date();
      this.lastFailureMessage = message;
      this.failureCount++;
      logger.error("Jira sync failed", { error: message, failureCount: this.failureCount });
      return [];
    }
  }

  getLastSyncTime(): Date | null {
    return this.lastSuccessfulSync;
  }

  getHealth(): IntegrationHealth {
    const configured = this.isConfigured();
    let status: IntegrationHealth["status"] = "unconfigured";

    if (configured) {
      if (this.failureCount === 0 && this.lastSuccessfulSync) {
        status = "healthy";
      } else if (this.failureCount > 0 && this.failureCount < 3) {
        status = "degraded";
      } else if (this.failureCount >= 3) {
        status = "down";
      } else {
        // Configured but never synced
        status = "healthy";
      }
    }

    return {
      source: this.source,
      configured,
      lastSuccessfulSync: this.lastSuccessfulSync,
      lastFailure: this.lastFailure,
      lastFailureMessage: this.lastFailureMessage,
      queueBacklog: 0,
      rateLimitRemaining: this.rateLimitRemaining,
      failureCount: this.failureCount,
      status,
    };
  }
}
