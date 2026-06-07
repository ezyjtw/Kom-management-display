import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import type {
  IntegrationAdapter,
  IntegrationHealth,
  NormalizedEvent,
  NormalizedPayload,
} from "@/modules/integrations/types";

interface ConfluenceConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

interface ConfluencePage {
  id: string;
  title: string;
  status: string;
  space: { key: string };
  version: { number: number; when: string; by: { displayName: string; email?: string } };
  history?: { createdDate: string; createdBy: { displayName: string; email?: string } };
  _links?: { webui?: string };
}

interface ConfluenceSearchResult {
  results: ConfluencePage[];
  start: number;
  limit: number;
  size: number;
}

function getConfluenceConfig(): ConfluenceConfig | null {
  const baseUrl = env("CONFLUENCE_BASE_URL");
  const email = env("CONFLUENCE_EMAIL");
  const apiToken = env("CONFLUENCE_API_TOKEN");
  if (!baseUrl || !email || !apiToken) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), email, apiToken };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function confluenceFetchWithRetry<T>(
  config: ConfluenceConfig,
  path: string,
  maxRetries = 3,
): Promise<{ data: T; rateLimitRemaining?: number }> {
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${config.baseUrl}${path}`, {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
        },
      });

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10);
        logger.warn("Confluence rate limited, backing off", { retryAfter, attempt });
        await sleep(retryAfter * 1000);
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => res.statusText);
        throw new Error(`Confluence API ${res.status}: ${body}`);
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
        logger.warn("Confluence fetch retry", { attempt, backoff, error: lastError.message });
        await sleep(backoff);
      }
    }
  }

  throw lastError ?? new Error("Confluence fetch failed after retries");
}

function mapPageToEvent(page: ConfluencePage, config: ConfluenceConfig): NormalizedEvent {
  const participants: NormalizedPayload["participants"] = [];
  if (page.history?.createdBy) {
    participants.push({
      name: page.history.createdBy.displayName,
      email: page.history.createdBy.email,
      role: "author",
    });
  }
  if (page.version.by && page.version.by.email !== page.history?.createdBy?.email) {
    participants.push({
      name: page.version.by.displayName,
      email: page.version.by.email,
      role: "editor",
    });
  }

  const isNew = page.version.number === 1;
  const pageUrl = page._links?.webui ? `${config.baseUrl}/wiki${page._links.webui}` : "";

  return {
    id: `confluence-${page.id}-v${page.version.number}`,
    sourceSystem: "confluence",
    sourceId: page.id,
    entityType: "document",
    eventType: isNew ? "created" : "updated",
    occurredAt: new Date(page.version.when),
    receivedAt: new Date(),
    payload: {
      subject: page.title,
      status: page.status,
      actor: page.version.by
        ? { name: page.version.by.displayName, email: page.version.by.email }
        : undefined,
      participants,
      metadata: {
        spaceKey: page.space.key,
        version: page.version.number,
        pageUrl,
      },
    },
    rawPayload: page as unknown as Record<string, unknown>,
  };
}

export class ConfluenceAdapter implements IntegrationAdapter {
  readonly source = "confluence" as const;

  private lastSuccessfulSync: Date | null = null;
  private lastFailure: Date | null = null;
  private lastFailureMessage?: string;
  private failureCount = 0;
  private rateLimitRemaining?: number;

  isConfigured(): boolean {
    return getConfluenceConfig() !== null;
  }

  async sync(opts?: Record<string, unknown>): Promise<NormalizedEvent[]> {
    const config = getConfluenceConfig();
    if (!config) {
      logger.warn("Confluence adapter not configured, skipping sync");
      return [];
    }

    const spaceKey = (opts?.spaceKey as string) ?? undefined;
    const cql = (opts?.cql as string) ??
      (spaceKey
        ? `space = "${spaceKey}" AND type = page AND lastModified >= now("-7d") ORDER BY lastModified DESC`
        : `type = page AND lastModified >= now("-7d") ORDER BY lastModified DESC`);
    const encoded = encodeURIComponent(cql);
    const maxResults = (opts?.maxResults as number) ?? 50;

    try {
      logger.info("Confluence sync starting", { spaceKey, cql });

      const { data, rateLimitRemaining } = await confluenceFetchWithRetry<ConfluenceSearchResult>(
        config,
        `/wiki/rest/api/content/search?cql=${encoded}&limit=${maxResults}&expand=version,space,history,history.createdBy`,
      );

      this.rateLimitRemaining = rateLimitRemaining;

      const events: NormalizedEvent[] = data.results.map((page) =>
        mapPageToEvent(page, config),
      );

      this.lastSuccessfulSync = new Date();
      this.failureCount = 0;
      logger.info("Confluence sync completed", {
        total: data.size,
        fetched: events.length,
      });

      return events;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastFailure = new Date();
      this.lastFailureMessage = message;
      this.failureCount++;
      logger.error("Confluence sync failed", { error: message, failureCount: this.failureCount });
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
