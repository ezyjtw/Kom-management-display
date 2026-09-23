/**
 * Read-only Komainu API v1.6.0 client (H2).
 * Only the allowlisted endpoints in endpoints.ts can be called; the single
 * non-GET call permitted is POST /v1/auth/token, made internally.
 */

import { env } from "@/lib/env";
import { AUTH_TOKEN_PATH, isAllowedEndpoint } from "./endpoints";
import type { KomainuPagedResponse, KomainuRequest, KomainuTransaction } from "./types";
import { httpFetch } from "@/lib/http/client";

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

interface KomainuConfig {
  baseUrl: string;
  apiUser: string;
  apiSecret: string;
}

let tokenCache: { accessToken: string; expiresAt: number } | null = null;

function getConfig(): KomainuConfig | null {
  const baseUrl = env("KOMAINU_API_BASE_URL");
  const apiUser = env("KOMAINU_API_USER");
  const apiSecret = env("KOMAINU_API_SECRET");
  if (!baseUrl || !apiUser || !apiSecret) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiUser, apiSecret };
}

export function isKomainuConfigured(): boolean {
  return getConfig() !== null;
}

async function getAccessToken(config: KomainuConfig): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.accessToken;

  const res = await httpFetch(`${config.baseUrl}${AUTH_TOKEN_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_user: config.apiUser, api_secret: config.apiSecret }),
  });
  if (!res.ok) throw new Error(`Komainu auth failed: ${res.status}`);

  const data = await res.json();
  const expiresIn = (data.expires_in || 3600) as number;
  tokenCache = {
    accessToken: data.access_token as string,
    expiresAt: Date.now() + (expiresIn - 60) * 1000,
  };
  return tokenCache.accessToken;
}

/** Guard applied before any network access. Exported for tests. */
export function assertPermitted(method: string, path: string): void {
  if (method.toUpperCase() !== "GET") throw new ForbiddenMethodError(method, path);
  if (!isAllowedEndpoint("GET", path)) throw new ForbiddenPathError(path);
}

export async function komainuRequest<T>(
  method: string,
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  assertPermitted(method, path);

  const config = getConfig();
  if (!config) {
    throw new Error(
      "Komainu API not configured: KOMAINU_API_BASE_URL, KOMAINU_API_USER and KOMAINU_API_SECRET are required",
    );
  }

  const token = await getAccessToken(config);
  const url = new URL(`${config.baseUrl}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);

  const res = await httpFetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Komainu API error: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export function komainuGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  return komainuRequest<T>("GET", path, params);
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
