/**
 * Confluence Cloud client, read-only (spec §16.1). Only GET requests on the
 * content search and content endpoints; anything else throws before any
 * network call. Uses CONFLUENCE_* credentials, or the Atlassian service
 * account when those are not set ("same Atlassian service account").
 */

import { env } from "@/lib/env";
import { httpFetchWithRetry } from "@/lib/http/client";

export const CONFLUENCE_ALLOWLIST: ReadonlyArray<{ method: "GET"; pattern: RegExp; purpose: string }> = Object.freeze([
  { method: "GET", pattern: /^\/rest\/api\/content\/search$/, purpose: "find release-notes pages by CQL" },
  { method: "GET", pattern: /^\/rest\/api\/content\/\d+$/, purpose: "read a page (storage format and version)" },
]);

export class ConfluenceForbiddenError extends Error {
  constructor(method: string, path: string) {
    super(`Confluence client is read-only: ${method} ${path} is not allowlisted`);
    this.name = "ConfluenceForbiddenError";
  }
}

export function assertConfluencePermitted(method: string, path: string): void {
  if (!CONFLUENCE_ALLOWLIST.some((e) => e.method === method.toUpperCase() && e.pattern.test(path))) throw new ConfluenceForbiddenError(method, path);
}

function config(): { base: string; email: string; token: string } | null {
  const explicit = env("CONFLUENCE_BASE_URL");
  const atlassian = env("ATLASSIAN_BASE_URL");
  const base = explicit ? explicit.replace(/\/+$/, "") : atlassian ? `${atlassian.replace(/\/+$/, "")}/wiki` : null;
  const email = env("CONFLUENCE_EMAIL") || env("ATLASSIAN_EMAIL");
  const token = env("CONFLUENCE_API_TOKEN") || env("ATLASSIAN_API_TOKEN");
  return base && email && token ? { base, email, token } : null;
}

export const isConfluenceConfigured = () => config() !== null;

export function pageUrl(webui: string | undefined): string {
  const cfg = config();
  return cfg && webui ? `${cfg.base}${webui}` : "";
}

async function confluenceGet<T>(path: string, query: Record<string, string> = {}): Promise<T> {
  assertConfluencePermitted("GET", path);
  const cfg = config();
  if (!cfg) throw new Error("Confluence not configured: CONFLUENCE_BASE_URL (or ATLASSIAN_BASE_URL) and credentials are required");
  const url = new URL(`${cfg.base}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await httpFetchWithRetry(url, {
    method: "GET",
    headers: { Authorization: `Basic ${Buffer.from(`${cfg.email}:${cfg.token}`).toString("base64")}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Confluence GET ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export interface ConfluencePageRef {
  id: string;
  title: string;
  version?: { number: number };
  _links?: { webui?: string };
}

export interface ConfluencePage extends ConfluencePageRef {
  body?: { storage?: { value: string } };
}

/** Pages matching a CQL query (with version numbers). */
export async function searchPages(cql: string, limit = 50): Promise<ConfluencePageRef[]> {
  const res = await confluenceGet<{ results?: ConfluencePageRef[] }>("/rest/api/content/search", { cql, limit: String(limit), expand: "version" });
  return res.results ?? [];
}

/** A page with its storage-format body and version. */
export function getPage(id: string): Promise<ConfluencePage> {
  if (!/^\d+$/.test(id)) throw new ConfluenceForbiddenError("GET", `/rest/api/content/${id}`);
  return confluenceGet<ConfluencePage>(`/rest/api/content/${id}`, { expand: "body.storage,version" });
}
