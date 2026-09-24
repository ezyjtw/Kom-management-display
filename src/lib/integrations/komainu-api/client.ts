/**
 * Read-only Komainu API v1.6.0 client (H2, spec §8.1).
 *
 * Only allowlisted endpoints (endpoints.ts) can be called, and only with GET;
 * the single non-GET call is POST /v1/auth/token, made internally.
 *
 * Multiple API users are supported (CONFIRM-API-SCOPE): KOMAINU_API_CREDENTIALS
 * is a JSON array of {label, user, secretRef}, where secretRef names the env
 * var holding that user's secret (KOMAINU_API_SECRET_<SUFFIX>). Without it the
 * single KOMAINU_API_USER / KOMAINU_API_SECRET pair is used.
 */

import { z } from "zod";
import { env, secret } from "@/lib/env";
import { CircuitBreaker } from "@/lib/circuit-breaker";
import { httpFetch, httpFetchWithRetry } from "@/lib/http/client";
import { logger } from "@/lib/logger";
import { recordCredentialUse } from "@/modules/security/record";
import { AUTH_TOKEN_PATH, isAllowedEndpoint } from "./endpoints";
import type { KomainuPagedResponse, KomainuRequest, KomainuTransaction } from "./types";

export type { KomainuPagedResponse, KomainuRequest, KomainuTransaction } from "./types";

export class ForbiddenMethodError extends Error {
  constructor(method: string, path: string) {
    super(`Komainu API client is read-only: ${method.toUpperCase()} ${path} is not permitted`);
    this.name = "ForbiddenMethodError";
  }
}

export class ForbiddenPathError extends Error {
  constructor(path: string) {
    super(`Komainu API path not in allowlist: ${path}`);
    this.name = "ForbiddenPathError";
  }
}

export interface KomainuCredential {
  label: string;
  user: string;
  secret: string;
}

const credentialsSchema = z.array(
  z.object({
    label: z.string().min(1).max(100),
    user: z.string().min(1),
    secretRef: z.string().regex(/^KOMAINU_API_SECRET_[A-Z0-9_]+$/, "secretRef must name a KOMAINU_API_SECRET_* env var"),
  }),
).min(1);

/** Parse credentials from config. Secrets are looked up by reference and never logged. */
export function parseCredentials(cfg: {
  KOMAINU_API_CREDENTIALS?: string;
  KOMAINU_API_USER?: string;
  KOMAINU_API_SECRET?: string;
  lookupSecret: (name: string) => string | undefined;
}): KomainuCredential[] {
  if (cfg.KOMAINU_API_CREDENTIALS?.trim()) {
    try {
      const parsed = credentialsSchema.safeParse(JSON.parse(cfg.KOMAINU_API_CREDENTIALS));
      if (!parsed.success) {
        logger.error("KOMAINU_API_CREDENTIALS is invalid", { issues: parsed.error.issues.map((i) => i.message) });
        return [];
      }
      return parsed.data.flatMap((c) => {
        const secret = cfg.lookupSecret(c.secretRef);
        if (!secret) {
          logger.error("Komainu API credential secret not set", { label: c.label, secretRef: c.secretRef });
          return [];
        }
        return [{ label: c.label, user: c.user, secret }];
      });
    } catch {
      logger.error("KOMAINU_API_CREDENTIALS is not valid JSON");
      return [];
    }
  }
  if (cfg.KOMAINU_API_USER && cfg.KOMAINU_API_SECRET) {
    return [{ label: "default", user: cfg.KOMAINU_API_USER, secret: cfg.KOMAINU_API_SECRET }];
  }
  return [];
}

function getBaseUrl(): string | null {
  const baseUrl = env("KOMAINU_API_BASE_URL");
  return baseUrl ? baseUrl.replace(/\/+$/, "") : null;
}

export function getCredentials(): KomainuCredential[] {
  return parseCredentials({
    KOMAINU_API_CREDENTIALS: env("KOMAINU_API_CREDENTIALS"),
    KOMAINU_API_USER: env("KOMAINU_API_USER"),
    KOMAINU_API_SECRET: env("KOMAINU_API_SECRET"),
    lookupSecret: (name) => secret(name),
  });
}

export function isKomainuConfigured(): boolean {
  return getBaseUrl() !== null && getCredentials().length > 0;
}

const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();
let lastRateLimitRemaining: number | undefined;

export function getLastRateLimitRemaining(): number | undefined {
  return lastRateLimitRemaining;
}

async function getAccessToken(baseUrl: string, cred: KomainuCredential): Promise<string> {
  const cached = tokenCache.get(cred.label);
  if (cached && Date.now() < cached.expiresAt) return cached.accessToken;

  const res = await httpFetch(`${baseUrl}${AUTH_TOKEN_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_user: cred.user, api_secret: cred.secret }),
  });
  // Spec §17.7: every use of a Komainu API credential is audit-logged (label only, never the user or secret).
  void recordCredentialUse({ connector: "komainu_api", credentialLabel: cred.label, workload: env("KOM_WORKLOAD") });
  if (!res.ok) throw new Error(`Komainu auth failed for ${cred.label}: ${res.status}`);

  const data = await res.json();
  const expiresIn = (data.expires_in || 3600) as number;
  tokenCache.set(cred.label, {
    accessToken: data.access_token as string,
    expiresAt: Date.now() + (expiresIn - 60) * 1000,
  });
  return data.access_token as string;
}

/** Guard applied before any network access. Exported for tests. */
export function assertPermitted(method: string, path: string): void {
  if (method.toUpperCase() !== "GET") throw new ForbiddenMethodError(method, path);
  if (!isAllowedEndpoint("GET", path)) throw new ForbiddenPathError(path);
}

const breaker = () => CircuitBreaker.for("komainu_api", { callTimeoutMs: 90_000 });

export async function komainuRequest<T>(
  method: string,
  path: string,
  params?: Record<string, string>,
  credential?: KomainuCredential,
): Promise<T> {
  assertPermitted(method, path);

  const baseUrl = getBaseUrl();
  const cred = credential ?? getCredentials()[0];
  if (!baseUrl || !cred) {
    throw new Error(
      "Komainu API not configured: KOMAINU_API_BASE_URL and KOMAINU_API_USER/KOMAINU_API_SECRET (or KOMAINU_API_CREDENTIALS) are required",
    );
  }

  return breaker().execute(async () => {
    const token = await getAccessToken(baseUrl, cred);
    const url = new URL(`${baseUrl}${path}`);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);

    const res = await httpFetchWithRetry(
      url,
      { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
      { onRateLimit: (n) => { lastRateLimitRemaining = n; } },
    );
    if (res.status === 401) tokenCache.delete(cred.label);
    if (!res.ok) throw new Error(`Komainu API error: ${res.status} ${res.statusText}`);
    return res.json() as Promise<T>;
  });
}

export function komainuGet<T>(path: string, params?: Record<string, string>, credential?: KomainuCredential): Promise<T> {
  return komainuRequest<T>("GET", path, params, credential);
}

export const MAX_PAGES = 50;

/** Fetch every page of a paged endpoint ({page, has_next, data}), up to MAX_PAGES. */
export async function fetchAllPages<T>(
  path: string,
  params: Record<string, string>,
  credential?: KomainuCredential,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await komainuGet<KomainuPagedResponse<T>>(path, { ...params, page: String(page), page_size: "100" }, credential);
    out.push(...(res.data ?? []));
    if (!res.has_next) return out;
  }
  logger.warn("Komainu paging stopped at MAX_PAGES", { path, pages: MAX_PAGES });
  return out;
}

/** Run a fetch for every configured credential; failures of one credential do not hide the others. */
export async function forEachCredential<T>(
  fn: (cred: KomainuCredential) => Promise<T[]>,
): Promise<{ results: Array<{ label: string; items: T[] }>; errors: Array<{ label: string; error: string }> }> {
  const results: Array<{ label: string; items: T[] }> = [];
  const errors: Array<{ label: string; error: string }> = [];
  for (const cred of getCredentials()) {
    try {
      results.push({ label: cred.label, items: await fn(cred) });
    } catch (error) {
      errors.push({ label: cred.label, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { results, errors };
}

export async function fetchPendingTransactions(
  opts: { page?: number; pageSize?: number; asset?: string } = {},
): Promise<KomainuPagedResponse<KomainuTransaction>> {
  const params: Record<string, string> = { status: "PENDING" };
  if (opts.page) params.page = String(opts.page);
  if (opts.pageSize) params.page_size = String(opts.pageSize);
  if (opts.asset) params.asset = opts.asset;
  return komainuGet("/v1/custody/transactions", params);
}

export async function fetchTransactions(
  params: Record<string, string>,
): Promise<KomainuPagedResponse<KomainuTransaction>> {
  return komainuGet("/v1/custody/transactions", params);
}

export async function fetchPendingRequests(
  opts: { page?: number; pageSize?: number; type?: string } = {},
): Promise<KomainuPagedResponse<KomainuRequest>> {
  const params: Record<string, string> = { status: "PENDING" };
  if (opts.page) params.page = String(opts.page);
  if (opts.pageSize) params.page_size = String(opts.pageSize);
  if (opts.type) params.type = opts.type;
  return komainuGet("/v1/requests", params);
}

export async function fetchRequests(
  params: Record<string, string>,
): Promise<KomainuPagedResponse<KomainuRequest>> {
  return komainuGet("/v1/requests", params);
}

export async function fetchTransaction(transactionId: string): Promise<KomainuTransaction> {
  return komainuGet(`/v1/custody/transactions/${encodeURIComponent(transactionId)}`);
}

export async function fetchRequest(requestId: string): Promise<KomainuRequest> {
  return komainuGet(`/v1/requests/${encodeURIComponent(requestId)}`);
}
