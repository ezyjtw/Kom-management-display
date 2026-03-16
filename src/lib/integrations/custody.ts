/**
 * Custody API client for fetching custody data.
 *
 * Auth: POST /v1/auth/token with api_user + api_secret → JWT bearer token
 * Transactions: GET /v1/custody/transactions?status=PENDING
 * Requests: GET /v1/requests?status=PENDING
 */

import { env } from "@/lib/env";

interface CustodyConfig {
  baseUrl: string;
  apiUser: string;
  apiSecret: string;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let tokenCache: TokenCache | null = null;

function getConfig(): CustodyConfig | null {
  const baseUrl = env("CUSTODY_API_BASE_URL");
  const apiUser = env("CUSTODY_API_USER");
  const apiSecret = env("CUSTODY_API_SECRET");

  if (!baseUrl || !apiUser || !apiSecret) return null;

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiUser, apiSecret };
}

/**
 * Authenticate with the Custody API and return a bearer token.
 * Caches the token until 60s before expiry.
 */
async function getAccessToken(config: CustodyConfig): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const res = await fetch(`${config.baseUrl}/v1/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_user: config.apiUser,
      api_secret: config.apiSecret,
    }),
  });

  if (!res.ok) {
    throw new Error(`Custody auth failed: ${res.status}`);
  }

  const data = await res.json();
  const expiresIn = (data.expires_in || 3600) as number;

  tokenCache = {
    accessToken: data.access_token as string,
    expiresAt: Date.now() + (expiresIn - 60) * 1000,
  };

  return tokenCache.accessToken;
}

/**
 * Make an authenticated GET request to the Custody API.
 */
async function custodyGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const config = getConfig();
  if (!config) {
    throw new Error(
      "Custody API not configured: CUSTODY_API_BASE_URL, CUSTODY_API_USER, and CUSTODY_API_SECRET are required"
    );
  }

  const token = await getAccessToken(config);
  const url = new URL(`${config.baseUrl}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Custody API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Make an authenticated POST/PUT request to the Custody API.
 */
async function custodyPost<T>(
  path: string,
  method: "POST" | "PUT" = "POST",
  body?: Record<string, unknown>,
): Promise<T> {
  const config = getConfig();
  if (!config) {
    throw new Error(
      "Custody API not configured: CUSTODY_API_BASE_URL, CUSTODY_API_USER, and CUSTODY_API_SECRET are required"
    );
  }

  const token = await getAccessToken(config);

  const res = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Custody API ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ─── Public API ───

export interface CustodyPagedResponse<T> {
  page: number;
  count: number;
  has_next: boolean;
  data: T[];
}

export interface CustodyTransaction {
  id: string;
  wallet_id: string;
  direction: "IN" | "OUT" | "FLAT";
  asset: string;
  amount: number;
  fees: number;
  created_at: string;
  transaction_type: string;
  status: "PENDING" | "BROADCASTED" | "CONFIRMED" | "FAILED";
  tx_hash: string;
  sender_address: string;
  receiver_address: string;
  note: string;
  created_by: string;
  workspace: string;
  external_reference: string;
  organization: string;
  account: string;
}

export interface CustodyRequest {
  id: string;
  type: "CREATE_TRANSACTION" | "COLLATERAL_OPERATION_OFFCHAIN" | "COLLATERAL_OPERATION_ONCHAIN";
  status: "CREATED" | "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED" | "BLOCKED";
  entity: "TRANSACTION" | "COLLATERAL" | "TOKENISATION";
  entity_id?: string;
  requested_by: string;
  requested_at: string;
  expires_at: string;
  updated_at: string;
  workspace: string;
  organization: string;
  account: string;
}

/**
 * Fetch pending transactions from the Custody API.
 */
export async function fetchPendingTransactions(
  opts: { page?: number; pageSize?: number; asset?: string } = {}
): Promise<CustodyPagedResponse<CustodyTransaction>> {
  const params: Record<string, string> = { status: "PENDING" };
  if (opts.page) params.page = String(opts.page);
  if (opts.pageSize) params.page_size = String(opts.pageSize);
  if (opts.asset) params.asset = opts.asset;

  return custodyGet<CustodyPagedResponse<CustodyTransaction>>(
    "/v1/custody/transactions",
    params
  );
}

/**
 * Fetch pending requests (transaction approvals waiting) from the Custody API.
 */
export async function fetchPendingRequests(
  opts: { page?: number; pageSize?: number; type?: string } = {}
): Promise<CustodyPagedResponse<CustodyRequest>> {
  const params: Record<string, string> = { status: "PENDING" };
  if (opts.page) params.page = String(opts.page);
  if (opts.pageSize) params.page_size = String(opts.pageSize);
  if (opts.type) params.type = opts.type;

  return custodyGet<CustodyPagedResponse<CustodyRequest>>("/v1/requests", params);
}

/**
 * Fetch a single transaction by ID.
 */
export async function fetchTransaction(transactionId: string): Promise<CustodyTransaction> {
  return custodyGet<CustodyTransaction>(`/v1/custody/transactions/${transactionId}`);
}

/**
 * Fetch a single request by ID to check its current status.
 */
export async function fetchRequest(requestId: string): Promise<CustodyRequest> {
  return custodyGet<CustodyRequest>(`/v1/requests/${requestId}`);
}

/**
 * Approve a pending request via the Custody API.
 * Returns the updated request object.
 */
export async function approveRequest(requestId: string): Promise<CustodyRequest> {
  return custodyPost<CustodyRequest>(`/v1/requests/${requestId}/approve`, "POST");
}

/**
 * Check if the Custody API is configured.
 */
export function isCustodyConfigured(): boolean {
  return getConfig() !== null;
}
