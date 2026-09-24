/**
 * Microsoft Graph client (spec §8.5). Application permissions Mail.Read and
 * ChannelMessage.Read.All; read-only (GET), plus the client-credentials token
 * request and one human-triggered write: replying to a client email (§9.7,
 * Mail.Send, behind clientIncidents.emailReplyEnabled). Mail access must be restricted to the configured mailboxes
 * by an Exchange application access policy (IT, not code).
 */

import { z } from "zod";
import { env } from "@/lib/env";
import { CircuitBreaker } from "@/lib/circuit-breaker";
import { httpFetch, httpFetchWithRetry } from "@/lib/http/client";
import { logger } from "@/lib/logger";

const GRAPH = "https://graph.microsoft.com";

const SEG = "[^/?#]+";
const GRAPH_GET_ALLOWLIST: readonly RegExp[] = Object.freeze([
  new RegExp(`^/v1\\.0/users/${SEG}/mailFolders/inbox/messages$`),
  // Delta queries per mailbox folder (spec §8.5): 5-minute polling from a stored delta token.
  new RegExp(`^/v1\\.0/users/${SEG}/mailFolders/${SEG}/messages/delta$`),
  new RegExp(`^/v1\\.0/teams/${SEG}/channels/${SEG}/messages$`),
]);

export class GraphForbiddenError extends Error {
  constructor(method: string, path: string) {
    super(`Graph request not allowlisted: ${method} ${path}`);
    this.name = "GraphForbiddenError";
  }
}

/** Accepts a path or an absolute @odata.nextLink; both must be GET on graph.microsoft.com and allowlisted. */
export function assertGraphPermitted(method: string, pathOrUrl: string): URL {
  const url = new URL(pathOrUrl, GRAPH);
  if (method.toUpperCase() !== "GET" || url.origin !== GRAPH || !GRAPH_GET_ALLOWLIST.some((re) => re.test(url.pathname))) {
    throw new GraphForbiddenError(method, url.pathname);
  }
  return url;
}

export const mailboxSchema = z.array(
  z.object({
    label: z.string().regex(/^[a-z0-9_]+$/),
    address: z.string().email(),
    purpose: z.enum(["custody", "fab_ics", "vendor_notifications"]),
    /** Well-known names or folder ids polled besides the Inbox (spec §8.5). */
    folders: z.array(z.string().regex(/^[A-Za-z0-9=_-]{1,200}$/)).max(10).optional(),
  }),
);
export const teamsChannelSchema = z.array(
  z.object({ label: z.string().regex(/^[a-z0-9_]+$/), teamId: z.string().min(1), channelId: z.string().min(1) }),
);
export type GraphMailbox = z.infer<typeof mailboxSchema>[number];
export type GraphTeamsChannel = z.infer<typeof teamsChannelSchema>[number];

function parseJsonList<T>(raw: string | undefined, schema: z.ZodType<T[]>, name: string): T[] {
  if (!raw?.trim()) return [];
  try {
    const r = schema.safeParse(JSON.parse(raw));
    if (r.success) return r.data;
    logger.error(`${name} is invalid`, { issues: r.error.issues.map((i) => i.message) });
  } catch {
    logger.error(`${name} is not valid JSON`);
  }
  return [];
}

// TODO(CONFIRM-MAILBOXES): addresses and purposes come from IT/Compliance.
export const getMailboxes = () => parseJsonList(env("GRAPH_MAILBOXES"), mailboxSchema, "GRAPH_MAILBOXES");
export const getTeamsChannels = () => parseJsonList(env("GRAPH_TEAMS_CHANNELS"), teamsChannelSchema, "GRAPH_TEAMS_CHANNELS");

export function isGraphConfigured(): boolean {
  return Boolean(env("GRAPH_TENANT_ID") && env("GRAPH_CLIENT_ID") && env("GRAPH_CLIENT_SECRET"));
}

let token: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (token && Date.now() < token.expiresAt) return token.value;
  const tenant = env("GRAPH_TENANT_ID");
  if (!tenant || !/^[a-zA-Z0-9.-]+$/.test(tenant)) throw new Error("GRAPH_TENANT_ID missing or invalid");
  const res = await httpFetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GRAPH_CLIENT_ID") ?? "",
      client_secret: env("GRAPH_CLIENT_SECRET") ?? "",
      scope: `${GRAPH}/.default`,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Graph token request failed: ${res.status}`);
  const data = await res.json();
  token = { value: data.access_token, expiresAt: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000 };
  return token.value;
}

const breaker = () => CircuitBreaker.for("graph", { callTimeoutMs: 90_000 });

/** GET every page (following @odata.nextLink, capped). */
export async function graphList<T>(path: string, query: Record<string, string> = {}, maxPages = 10): Promise<T[]> {
  const first = assertGraphPermitted("GET", path);
  for (const [k, v] of Object.entries(query)) first.searchParams.set(k, v);
  return breaker().execute(async () => {
    const out: T[] = [];
    let next: URL | null = first;
    for (let i = 0; next && i < maxPages; i++) {
      const res = await httpFetchWithRetry(next, { headers: { Authorization: `Bearer ${await getToken()}`, Accept: "application/json" } });
      if (!res.ok) throw new Error(`Graph GET ${next.pathname} failed: ${res.status}`);
      const body = (await res.json()) as { value?: T[]; "@odata.nextLink"?: string };
      out.push(...(body.value ?? []));
      next = body["@odata.nextLink"] ? assertGraphPermitted("GET", body["@odata.nextLink"]) : null;
    }
    return out;
  });
}

export interface GraphMessage {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  receivedDateTime?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: Array<{ emailAddress?: { address?: string } }>;
  bodyPreview?: string;
}

export function listInboxSince(address: string, since: Date): Promise<GraphMessage[]> {
  return graphList<GraphMessage>(`/v1.0/users/${encodeURIComponent(address)}/mailFolders/inbox/messages`, {
    $filter: `receivedDateTime ge ${since.toISOString()}`,
    $orderby: "receivedDateTime asc",
    $select: "id,internetMessageId,conversationId,subject,receivedDateTime,from,toRecipients,bodyPreview",
    $top: "50",
  });
}

export interface GraphChannelMessage {
  id: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  messageType?: string;
  from?: { user?: { displayName?: string; id?: string } | null; application?: { displayName?: string } | null } | null;
  body?: { contentType?: string; content?: string };
}

export function listChannelMessages(teamId: string, channelId: string): Promise<GraphChannelMessage[]> {
  return graphList<GraphChannelMessage>(
    `/v1.0/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`,
    { $top: "50" },
    1,
  );
}

export interface DeltaPage {
  messages: Array<GraphMessage & { "@removed"?: unknown }>;
  /** Link to store for the next cycle: the final deltaLink, or a nextLink when the page cap was hit. */
  cursor: string | null;
}

const MESSAGE_SELECT = "id,internetMessageId,conversationId,subject,receivedDateTime,from,toRecipients,bodyPreview";

/**
 * Delta query on a mailbox folder, from a stored delta/next link or from the
 * start. TODO(CONFIRM-GRAPH-DELTA): confirm page size and first-sync volume on
 * the tenant; the first sync is capped and continues from the stored link.
 */
export async function listFolderDelta(address: string, folder: string, cursor: string | null, maxPages = 10): Promise<DeltaPage> {
  const first = cursor
    ? assertGraphPermitted("GET", cursor)
    : (() => {
        const u = assertGraphPermitted("GET", `/v1.0/users/${encodeURIComponent(address)}/mailFolders/${encodeURIComponent(folder)}/messages/delta`);
        u.searchParams.set("$select", MESSAGE_SELECT);
        return u;
      })();
  return breaker().execute(async () => {
    const messages: DeltaPage["messages"] = [];
    let next: URL | null = first;
    let saved: string | null = cursor;
    for (let i = 0; next && i < maxPages; i++) {
      const res = await httpFetchWithRetry(next, { headers: { Authorization: `Bearer ${await getToken()}`, Accept: "application/json", Prefer: "odata.maxpagesize=50" } });
      if (!res.ok) throw new Error(`Graph delta ${next.pathname} failed: ${res.status}`);
      const body = (await res.json()) as { value?: DeltaPage["messages"]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
      messages.push(...(body.value ?? []));
      if (body["@odata.deltaLink"]) {
        saved = body["@odata.deltaLink"];
        next = null;
      } else if (body["@odata.nextLink"]) {
        saved = body["@odata.nextLink"];
        next = assertGraphPermitted("GET", body["@odata.nextLink"]);
      } else {
        next = null;
      }
    }
    return { messages, cursor: saved };
  });
}

const GRAPH_POST_ALLOWLIST: readonly RegExp[] = Object.freeze([
  // Spec §9.7: a human-sent reply to a client email conversation. Needs Mail.Send (TODO(CONFIRM-GRAPH-MAIL-SEND)).
  new RegExp(`^/v1\\.0/users/${SEG}/messages/${SEG}/reply$`),
]);

/**
 * Reply to a message in a shared mailbox. Only called from an explicit operator
 * "Send" on a drafted message; never automatically (H12).
 */
export async function replyToMessage(address: string, messageId: string, comment: string): Promise<void> {
  const url = new URL(`/v1.0/users/${encodeURIComponent(address)}/messages/${encodeURIComponent(messageId)}/reply`, GRAPH);
  if (!GRAPH_POST_ALLOWLIST.some((re) => re.test(url.pathname))) throw new GraphForbiddenError("POST", url.pathname);
  await breaker().execute(async () => {
    const res = await httpFetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    });
    if (!res.ok) throw new Error(`Graph reply failed: ${res.status}`);
  });
}
