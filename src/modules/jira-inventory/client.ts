/**
 * Read-only Jira client for the inventory (spec §15). Separate from the
 * runtime client on purpose: it has its own allowlist of GET endpoints (plus
 * the read-only JQL search POST) and cannot reach any write endpoint. It
 * never changes Jira configuration (spec §0).
 */

import { env } from "@/lib/env";
import { httpFetchWithRetry } from "@/lib/http/client";

const PROJECT = "[A-Z][A-Z0-9_]+";

export const INVENTORY_ALLOWLIST: ReadonlyArray<{ method: "GET" | "POST"; pattern: RegExp; purpose: string }> = Object.freeze([
  { method: "GET", pattern: new RegExp(`^/rest/api/3/project/${PROJECT}$`), purpose: "project and its issue types" },
  { method: "GET", pattern: new RegExp(`^/rest/api/3/project/${PROJECT}/statuses$`), purpose: "statuses per issue type" },
  { method: "GET", pattern: /^\/rest\/agile\/1\.0\/board$/, purpose: "boards for a project" },
  { method: "GET", pattern: /^\/rest\/api\/3\/workflowscheme\/project$/, purpose: "workflow scheme (workflow names)" },
  { method: "GET", pattern: /^\/rest\/api\/3\/filter\/search$/, purpose: "filters by owner, with JQL" },
  { method: "GET", pattern: /^\/rest\/api\/3\/dashboard\/search$/, purpose: "dashboards" },
  { method: "GET", pattern: /^\/rest\/api\/3\/dashboard\/\d+\/gadget$/, purpose: "dashboard gadgets" },
  { method: "GET", pattern: /^\/rest\/api\/3\/dashboard\/\d+\/items\/\d+\/properties$/, purpose: "gadget property keys" },
  { method: "GET", pattern: /^\/rest\/api\/3\/dashboard\/\d+\/items\/\d+\/properties\/[A-Za-z0-9._-]+$/, purpose: "gadget configuration (filter reference)" },
  { method: "GET", pattern: /^\/rest\/api\/3\/user\/search$/, purpose: "account id for a team member's email" },
  { method: "POST", pattern: /^\/rest\/api\/3\/search\/jql$/, purpose: "JQL search (read)" },
]);

export class InventoryForbiddenError extends Error {
  constructor(method: string, path: string) {
    super(`Jira inventory is read-only: ${method} ${path} is not on the inventory allowlist`);
    this.name = "InventoryForbiddenError";
  }
}

export function assertInventoryPermitted(method: string, path: string): void {
  if (!INVENTORY_ALLOWLIST.some((e) => e.method === method.toUpperCase() && e.pattern.test(path))) throw new InventoryForbiddenError(method, path);
}

export async function inventoryRequest<T>(method: "GET" | "POST", path: string, opts: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
  assertInventoryPermitted(method, path);
  const baseUrl = env("ATLASSIAN_BASE_URL");
  const email = env("ATLASSIAN_EMAIL");
  const token = env("ATLASSIAN_API_TOKEN");
  if (!baseUrl || !email || !token) throw new Error("Jira inventory needs ATLASSIAN_BASE_URL, ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN");
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const res = await httpFetchWithRetry(url, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
      Accept: "application/json",
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const err = new Error(`Jira ${method} ${path} failed: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Pages a startAt/maxResults endpoint that returns { values, isLast }. */
export async function paged<T>(path: string, query: Record<string, string>, maxPages = 20): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0, startAt = 0; page < maxPages; page++) {
    const res = await inventoryRequest<{ values?: T[]; isLast?: boolean; total?: number }>("GET", path, { query: { ...query, startAt: String(startAt), maxResults: "50" } });
    const values = res.values ?? [];
    out.push(...values);
    startAt += values.length;
    if (res.isLast !== false || values.length === 0) break;
  }
  return out;
}
