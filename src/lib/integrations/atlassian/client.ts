/**
 * Jira Cloud and JSM client (spec §8.2). Read plus a small allowlist of
 * writes. Never deletes, and never touches projects, workflows, fields,
 * schemes, automation or permissions (spec §0 rule 6).
 */

import { env } from "@/lib/env";
import { CircuitBreaker } from "@/lib/circuit-breaker";
import { httpFetch, httpFetchWithRetry } from "@/lib/http/client";

type Method = "GET" | "POST" | "PUT";

const KEY = "[A-Z][A-Z0-9_]+-\\d+";
const PROJECT = "[A-Z][A-Z0-9_]+";

/** Every permitted (method, path) pair. Anything else throws before any network call. */
export const ATLASSIAN_ALLOWLIST: ReadonlyArray<{ method: Method; pattern: RegExp; purpose: string }> = Object.freeze([
  { method: "GET", pattern: /^\/rest\/api\/3\/myself$/, purpose: "health" },
  { method: "POST", pattern: /^\/rest\/api\/3\/search\/jql$/, purpose: "JQL search (read)" },
  { method: "GET", pattern: new RegExp(`^/rest/api/3/issue/${KEY}$`), purpose: "read issue" },
  { method: "GET", pattern: new RegExp(`^/rest/api/3/issue/${KEY}/transitions$`), purpose: "discover transitions" },
  { method: "GET", pattern: new RegExp(`^/rest/api/3/issue/createmeta/${PROJECT}/issuetypes$`), purpose: "discover issue types" },
  { method: "GET", pattern: /^\/rest\/api\/3\/user\/search$/, purpose: "find assignee by email" },
  { method: "POST", pattern: /^\/rest\/api\/3\/issue$/, purpose: "create issue" },
  { method: "POST", pattern: new RegExp(`^/rest/api/3/issue/${KEY}/comment$`), purpose: "add comment" },
  { method: "PUT", pattern: new RegExp(`^/rest/api/3/issue/${KEY}/assignee$`), purpose: "assign" },
  { method: "POST", pattern: new RegExp(`^/rest/api/3/issue/${KEY}/transitions$`), purpose: "transition" },
  { method: "PUT", pattern: new RegExp(`^/rest/api/3/issue/${KEY}$`), purpose: "set labels / allowlisted custom fields" },
  { method: "POST", pattern: /^\/rest\/api\/3\/issueLink$/, purpose: "link issues" },
  { method: "GET", pattern: /^\/rest\/servicedeskapi\/servicedesk$/, purpose: "discover service desks" },
  { method: "GET", pattern: /^\/rest\/servicedeskapi\/organization$/, purpose: "organisations" },
  { method: "GET", pattern: new RegExp(`^/rest/servicedeskapi/request/${KEY}$`), purpose: "read request" },
  { method: "GET", pattern: new RegExp(`^/rest/servicedeskapi/request/${KEY}/sla$`), purpose: "request SLAs" },
  { method: "POST", pattern: /^\/rest\/servicedeskapi\/request$/, purpose: "create request" },
  { method: "POST", pattern: new RegExp(`^/rest/servicedeskapi/request/${KEY}/comment$`), purpose: "add request comment" },
  // Spec §9.7 client incident/risk requests
  { method: "GET", pattern: new RegExp(`^/rest/servicedeskapi/request/${KEY}/comment$`), purpose: "read request comments (client portal replies)" },
  { method: "GET", pattern: new RegExp(`^/rest/servicedeskapi/request/${KEY}/transition$`), purpose: "discover client-visible status transitions" },
  { method: "POST", pattern: new RegExp(`^/rest/servicedeskapi/request/${KEY}/transition$`), purpose: "move a client request through its client-visible statuses" },
  { method: "GET", pattern: /^\/rest\/servicedeskapi\/organization\/\d+\/user$/, purpose: "portal users of a client organisation" },
]);

export class AtlassianForbiddenError extends Error {
  constructor(method: string, path: string) {
    super(`Atlassian operation not allowlisted: ${method} ${path}`);
    this.name = "AtlassianForbiddenError";
  }
}

export class AtlassianApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "AtlassianApiError";
  }
}

export function assertAtlassianPermitted(method: string, path: string): void {
  const m = method.toUpperCase();
  if (!ATLASSIAN_ALLOWLIST.some((e) => e.method === m && e.pattern.test(path))) {
    throw new AtlassianForbiddenError(m, path);
  }
}

interface AtlassianConfig {
  baseUrl: string;
  email: string;
  token: string;
}

function getConfig(): AtlassianConfig | null {
  const baseUrl = env("ATLASSIAN_BASE_URL");
  const email = env("ATLASSIAN_EMAIL");
  const token = env("ATLASSIAN_API_TOKEN");
  if (!baseUrl || !email || !token) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), email, token };
}

export function isAtlassianConfigured(): boolean {
  return getConfig() !== null;
}

export function browseUrl(key: string): string | null {
  const cfg = getConfig();
  return cfg ? `${cfg.baseUrl}/browse/${key}` : null;
}

let lastRateLimitRemaining: number | undefined;
export const getAtlassianRateLimitRemaining = () => lastRateLimitRemaining;

const breaker = () => CircuitBreaker.for("atlassian", { callTimeoutMs: 60_000 });

export async function atlassianRequest<T>(
  method: Method,
  path: string,
  opts: { query?: Record<string, string>; body?: unknown } = {},
): Promise<T> {
  assertAtlassianPermitted(method, path);
  const cfg = getConfig();
  if (!cfg) throw new Error("Atlassian not configured: ATLASSIAN_BASE_URL, ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN are required");

  return breaker().execute(async () => {
    const url = new URL(`${cfg.baseUrl}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.email}:${cfg.token}`).toString("base64")}`,
        Accept: "application/json",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    };
    // Reads (incl. JQL search) retry on 429; writes do not, to avoid double-applying.
    const isRead = method === "GET" || path.endsWith("/search/jql");
    const res = isRead
      ? await httpFetchWithRetry(url, init, { onRateLimit: (n) => { lastRateLimitRemaining = n; } })
      : await httpFetch(url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AtlassianApiError(res.status, `Atlassian ${method} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
    }
    if (res.status === 204) return undefined as T;
    const body = await res.text();
    return (body ? JSON.parse(body) : undefined) as T;
  });
}

/** Atlassian Document Format for plain text. */
export function adf(text: string) {
  return {
    type: "doc",
    version: 1,
    content: text.split(/\n{2,}/).map((para) => ({ type: "paragraph", content: [{ type: "text", text: para }] })),
  };
}

// ─── Typed operations ───

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary?: string;
    status?: { name: string; statusCategory?: { key: string } };
    assignee?: { accountId: string; emailAddress?: string; displayName?: string } | null;
    priority?: { name: string } | null;
    created?: string;
    updated?: string;
    project?: { key: string };
    issuetype?: { name: string };
    labels?: string[];
  };
}

export const SEARCH_FIELDS = ["summary", "status", "assignee", "priority", "created", "updated", "project", "issuetype", "labels"];

export async function searchIssues(jql: string, maxPages = 20): Promise<JiraIssue[]> {
  const out: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const res = await atlassianRequest<{ issues?: JiraIssue[]; nextPageToken?: string; isLast?: boolean }>(
      "POST",
      "/rest/api/3/search/jql",
      { body: { jql, fields: SEARCH_FIELDS, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) } },
    );
    out.push(...(res.issues ?? []));
    if (res.isLast !== false || !res.nextPageToken) return out;
    nextPageToken = res.nextPageToken;
  }
  return out;
}

export function getIssue(key: string, fields = SEARCH_FIELDS): Promise<JiraIssue> {
  return atlassianRequest("GET", `/rest/api/3/issue/${key}`, { query: { fields: fields.join(",") } });
}

export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string; statusCategory?: { key: string } };
}

export async function getTransitions(key: string): Promise<JiraTransition[]> {
  return (await atlassianRequest<{ transitions: JiraTransition[] }>("GET", `/rest/api/3/issue/${key}/transitions`)).transitions ?? [];
}

export function transitionIssue(key: string, transitionId: string): Promise<void> {
  return atlassianRequest("POST", `/rest/api/3/issue/${key}/transitions`, { body: { transition: { id: transitionId } } });
}

export async function findAccountIdByEmail(email: string): Promise<string | null> {
  const users = await atlassianRequest<Array<{ accountId: string; emailAddress?: string; active?: boolean }>>(
    "GET",
    "/rest/api/3/user/search",
    { query: { query: email } },
  );
  const exact = users.filter((u) => u.emailAddress?.toLowerCase() === email.toLowerCase() && u.active !== false);
  return exact.length === 1 ? exact[0].accountId : null;
}

export function assignIssue(key: string, accountId: string | null): Promise<void> {
  return atlassianRequest("PUT", `/rest/api/3/issue/${key}/assignee`, { body: { accountId } });
}

/** Internal (Jira) comment. Public JSM replies go only through the Section 9 route. */
export function addComment(key: string, text: string): Promise<{ id: string }> {
  return atlassianRequest("POST", `/rest/api/3/issue/${key}/comment`, { body: { body: adf(text) } });
}

/** JSM request comment; internal (public: false) unless the caller explicitly asks. */
export function addRequestComment(key: string, text: string, opts: { public: boolean } = { public: false }): Promise<{ id: string }> {
  return atlassianRequest("POST", `/rest/servicedeskapi/request/${key}/comment`, { body: { body: text, public: opts.public } });
}

/**
 * Set labels and allowlisted custom fields only. Any other field is refused
 * before the request is made.
 */
export async function updateIssueFields(key: string, fields: Record<string, unknown>, allowedCustomFields: readonly string[]): Promise<void> {
  const refused = Object.keys(fields).filter((f) => f !== "labels" && !allowedCustomFields.includes(f));
  if (refused.length) throw new AtlassianForbiddenError("PUT", `/rest/api/3/issue/${key} fields: ${refused.join(", ")}`);
  await atlassianRequest("PUT", `/rest/api/3/issue/${key}`, { body: { fields } });
}

export function createIssue(input: { projectKey: string; issueTypeId: string; summary: string; description?: string; labels?: string[] }): Promise<{ id: string; key: string }> {
  return atlassianRequest("POST", "/rest/api/3/issue", {
    body: {
      fields: {
        project: { key: input.projectKey },
        issuetype: { id: input.issueTypeId },
        summary: input.summary.slice(0, 255),
        ...(input.description ? { description: adf(input.description) } : {}),
        labels: input.labels ?? ["kommand-centre"],
      },
    },
  });
}

export function linkIssues(inwardKey: string, outwardKey: string, typeName = "Relates"): Promise<void> {
  return atlassianRequest("POST", "/rest/api/3/issueLink", {
    body: { type: { name: typeName }, inwardIssue: { key: inwardKey }, outwardIssue: { key: outwardKey } },
  });
}

export async function discoverIssueTypes(projectKey: string): Promise<Record<string, string>> {
  const res = await atlassianRequest<{ issueTypes?: Array<{ id: string; name: string }>; values?: Array<{ id: string; name: string }> }>(
    "GET",
    `/rest/api/3/issue/createmeta/${projectKey}/issuetypes`,
  );
  return Object.fromEntries((res.issueTypes ?? res.values ?? []).map((t) => [t.name, t.id]));
}

/**
 * Create a JSM request (spec §9.2 rule 5). Field ids for organisation and
 * priority are configuration, never hard-coded.
 */
export function createServiceRequest(input: {
  serviceDeskId: string;
  requestTypeId: string;
  summary: string;
  description: string;
  labels: string[];
  organizationFieldId?: string;
  organizationId?: string | null;
  /** Spec §9.7: JSM customer account ids added as request participants (all in the client's organisation). */
  requestParticipants?: string[];
}): Promise<{ issueKey: string; issueId: string; _links?: { web?: string } }> {
  const requestFieldValues: Record<string, unknown> = {
    summary: input.summary.slice(0, 255),
    description: input.description,
    labels: input.labels,
  };
  if (input.organizationFieldId && input.organizationId) {
    requestFieldValues[input.organizationFieldId] = [Number(input.organizationId)];
  }
  return atlassianRequest("POST", "/rest/servicedeskapi/request", {
    body: {
      serviceDeskId: input.serviceDeskId,
      requestTypeId: input.requestTypeId,
      requestFieldValues,
      ...(input.requestParticipants?.length ? { requestParticipants: input.requestParticipants } : {}),
    },
  });
}

/**
 * Replace an issue's description. Only used by client intake to reflect an
 * edited client message (spec §9.2 rule 8); not exposed as a general field edit.
 */
export function updateIssueDescription(key: string, text: string): Promise<void> {
  return atlassianRequest("PUT", `/rest/api/3/issue/${key}`, { body: { fields: { description: adf(text) } } });
}

export interface JsmCustomer {
  accountId: string;
  emailAddress?: string;
  displayName?: string;
}

/** Customers (portal users) in a JSM organisation. */
export async function listOrganizationCustomers(organizationId: string): Promise<JsmCustomer[]> {
  if (!/^\d+$/.test(organizationId)) throw new AtlassianForbiddenError("GET", "organization id must be numeric");
  const res = await atlassianRequest<{ values?: JsmCustomer[] }>("GET", `/rest/servicedeskapi/organization/${organizationId}/user`);
  return res.values ?? [];
}

export interface JsmComment {
  id: string;
  body: string;
  public: boolean;
  author?: { accountId?: string; emailAddress?: string; displayName?: string };
  created?: { iso8601?: string };
}

export async function listRequestComments(key: string): Promise<JsmComment[]> {
  const res = await atlassianRequest<{ values?: JsmComment[] }>("GET", `/rest/servicedeskapi/request/${key}/comment`);
  return res.values ?? [];
}

export interface JsmTransition {
  id: string;
  name: string;
}

export async function listRequestTransitions(key: string): Promise<JsmTransition[]> {
  const res = await atlassianRequest<{ values?: JsmTransition[] }>("GET", `/rest/servicedeskapi/request/${key}/transition`);
  return res.values ?? [];
}

export function performRequestTransition(key: string, transitionId: string): Promise<void> {
  return atlassianRequest("POST", `/rest/servicedeskapi/request/${key}/transition`, { body: { id: transitionId } });
}
