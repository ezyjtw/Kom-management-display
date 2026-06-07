import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { normaliseSubject } from "@/lib/thread-utils";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";

interface ConfluenceConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export function getConfluenceConfig(): ConfluenceConfig | null {
  const baseUrl = env("CONFLUENCE_BASE_URL");
  const email = env("CONFLUENCE_EMAIL");
  const apiToken = env("CONFLUENCE_API_TOKEN");
  if (!baseUrl || !email || !apiToken) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), email, apiToken };
}

export function isConfluenceConfigured(): boolean {
  return getConfluenceConfig() !== null;
}

interface ConfluencePage {
  id: string;
  title: string;
  status: string;
  spaceId: string;
  version: { number: number; createdAt: string; message?: string; authorId?: string };
  _links?: { webui?: string };
}

interface ConfluencePageV1 {
  id: string;
  title: string;
  status: string;
  space: { key: string };
  version: { number: number; when: string; by: { displayName: string; email?: string } };
  history?: { createdDate: string; createdBy: { displayName: string; email?: string } };
  _links?: { webui?: string };
}

interface ConfluenceSearchResult {
  results: ConfluencePageV1[];
  start: number;
  limit: number;
  size: number;
  _links?: { next?: string };
}

async function confluenceFetch<T>(config: ConfluenceConfig, path: string): Promise<T> {
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  const url = path.startsWith("http") ? path : `${config.baseUrl}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Confluence API ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
  return res.json() as Promise<T>;
}

async function confluenceFetchWithRetry<T>(config: ConfluenceConfig, path: string, maxRetries = 3): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await confluenceFetch<T>(config, path);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        logger.warn("Confluence fetch retry", { attempt, backoff, error: lastError.message });
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }

  throw lastError ?? new Error("Confluence fetch failed after retries");
}

async function resolveEmployeeId(email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const employee = await prisma.employee.findFirst({
    where: { email, active: true },
    select: { id: true },
  });
  return employee?.id ?? null;
}

/**
 * Sync Confluence pages from a space into ConfluencePageState and CommsThread.
 */
export async function syncConfluenceSpace(
  spaceKey: string,
  queue: string = "Transaction Operations",
) {
  const config = getConfluenceConfig();
  if (!config) {
    throw new Error("Confluence not configured: CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL, and CONFLUENCE_API_TOKEN are required");
  }

  const cql = encodeURIComponent(`space = "${spaceKey}" AND type = page AND lastModified >= now("-7d") ORDER BY lastModified DESC`);
  const searchResult = await confluenceFetchWithRetry<ConfluenceSearchResult>(
    config,
    `/wiki/rest/api/content/search?cql=${cql}&limit=50&expand=version,space,history,history.createdBy`,
  );

  const synced: string[] = [];

  for (const page of searchResult.results) {
    const authorEmail = page.history?.createdBy?.email ?? null;
    const authorName = page.history?.createdBy?.displayName ?? null;
    const lastEditorEmail = page.version.by?.email ?? null;
    const lastEditorName = page.version.by?.displayName ?? null;
    const employeeId = await resolveEmployeeId(authorEmail);
    const createdInConfluence = page.history?.createdDate ? new Date(page.history.createdDate) : new Date(page.version.when);
    const updatedInConfluence = new Date(page.version.when);

    await prisma.confluencePageState.upsert({
      where: { pageId: page.id },
      create: {
        pageId: page.id,
        spaceKey: page.space.key,
        title: page.title,
        status: page.status,
        authorEmail,
        authorName,
        lastEditorEmail,
        lastEditorName,
        version: page.version.number,
        createdInConfluence,
        updatedInConfluence,
        employeeId,
      },
      update: {
        title: page.title,
        status: page.status,
        lastEditorEmail,
        lastEditorName,
        version: page.version.number,
        updatedInConfluence,
        lastSyncedAt: new Date(),
      },
    });

    const sourceRef = `confluence-${page.id}`;
    const existingThread = await prisma.commsThread.findFirst({
      where: { sourceThreadRef: sourceRef },
    });

    if (existingThread) {
      const data: Record<string, unknown> = {};
      if (updatedInConfluence > existingThread.lastMessageAt) {
        data.lastMessageAt = updatedInConfluence;
      }
      const freshSubject = normaliseSubject(page.title);
      if (freshSubject !== existingThread.subject) {
        data.subject = freshSubject;
      }
      if (Object.keys(data).length > 0) {
        await prisma.commsThread.update({ where: { id: existingThread.id }, data });
      }
      synced.push(existingThread.id);
      continue;
    }

    const pageUrl = page._links?.webui ? `${config.baseUrl}/wiki${page._links.webui}` : "";
    const thread = await prisma.commsThread.create({
      data: {
        source: "confluence",
        sourceThreadRef: sourceRef,
        participants: JSON.stringify([authorEmail, lastEditorEmail].filter(Boolean)),
        clientOrPartnerTag: page.space.key,
        subject: normaliseSubject(page.title),
        priority: "P3",
        status: "Unassigned",
        queue,
        lastMessageAt: updatedInConfluence,
        linkedRecords: JSON.stringify([
          { type: "confluence", id: page.id, label: page.title.substring(0, 120), url: pageUrl },
        ]),
      },
    });

    await prisma.commsMessage.create({
      data: {
        threadId: thread.id,
        authorName: authorName || "Confluence",
        authorType: "internal",
        bodySnippet: `Confluence page: ${page.title} (v${page.version.number})`,
        bodyLink: pageUrl,
        timestamp: createdInConfluence,
      },
    });

    synced.push(thread.id);
  }

  const cursor = await prisma.integrationSyncCursor.upsert({
    where: { source_scope: { source: "confluence", scope: spaceKey } },
    create: { source: "confluence", scope: spaceKey, cursor: new Date().toISOString() },
    update: { cursor: new Date().toISOString() },
  });

  logger.info("Confluence sync completed", {
    spaceKey,
    totalPages: searchResult.size,
    threadsSynced: synced.length,
    cursor: cursor.cursor,
  });

  return {
    space: spaceKey,
    totalPages: searchResult.size,
    threadsSynced: synced.length,
  };
}

export async function fetchPageById(pageId: string) {
  const config = getConfluenceConfig();
  if (!config) throw new Error("Confluence not configured");

  return confluenceFetchWithRetry<ConfluencePageV1>(
    config,
    `/wiki/rest/api/content/${pageId}?expand=version,space,history,history.createdBy`,
  );
}
