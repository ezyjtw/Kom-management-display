/**
 * Komainu API client for fetching custody data.
 *
 * Auth: POST /v1/auth/token with api_user + api_secret → JWT bearer token
 * Transactions: GET /v1/custody/transactions?status=PENDING
 * Requests: GET /v1/requests?status=PENDING
 */

interface KomainuConfig {
  baseUrl: string;
  apiUser: string;
  apiSecret: string;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let tokenCache: TokenCache | null = null;

function getConfig(): KomainuConfig | null {
  const baseUrl = process.env.KOMAINU_API_BASE_URL;
  const apiUser = process.env.KOMAINU_API_USER;
  const apiSecret = process.env.KOMAINU_API_SECRET;

  if (!baseUrl || !apiUser || !apiSecret) return null;

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiUser, apiSecret };
}

/**
 * Authenticate with the Komainu API and return a bearer token.
 * Caches the token until 60s before expiry.
 */
async function getAccessToken(config: KomainuConfig): Promise<string> {
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
    throw new Error(`Komainu auth failed: ${res.status}`);
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
 * Make an authenticated GET request to the Komainu API.
 */
async function komainuGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const config = getConfig();
  if (!config) {
    throw new Error(
      "Komainu API not configured: KOMAINU_API_BASE_URL, KOMAINU_API_USER, and KOMAINU_API_SECRET are required"
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
    throw new Error(`Komainu API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Make an authenticated POST/PUT request to the Komainu API.
 */
async function komainuPost<T>(
  path: string,
  method: "POST" | "PUT" = "POST",
  body?: Record<string, unknown>,
): Promise<T> {
  const config = getConfig();
  if (!config) {
    throw new Error(
      "Komainu API not configured: KOMAINU_API_BASE_URL, KOMAINU_API_USER, and KOMAINU_API_SECRET are required"
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
    throw new Error(`Komainu API ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ─── Public API ───

export interface KomainuPagedResponse<T> {
  page: number;
  count: number;
  has_next: boolean;
  data: T[];
}

export interface KomainuTransaction {
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

export interface KomainuRequest {
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
 * Fetch pending transactions from the Komainu custody API.
 */
export async function fetchPendingTransactions(
  opts: { page?: number; pageSize?: number; asset?: string } = {}
): Promise<KomainuPagedResponse<KomainuTransaction>> {
  const params: Record<string, string> = { status: "PENDING" };
  if (opts.page) params.page = String(opts.page);
  if (opts.pageSize) params.page_size = String(opts.pageSize);
  if (opts.asset) params.asset = opts.asset;

  return komainuGet<KomainuPagedResponse<KomainuTransaction>>(
    "/v1/custody/transactions",
    params
  );
}

/**
 * Fetch pending requests (transaction approvals waiting) from the Komainu API.
 */
export async function fetchPendingRequests(
  opts: { page?: number; pageSize?: number; type?: string } = {}
): Promise<KomainuPagedResponse<KomainuRequest>> {
  const params: Record<string, string> = { status: "PENDING" };
  if (opts.page) params.page = String(opts.page);
  if (opts.pageSize) params.page_size = String(opts.pageSize);
  if (opts.type) params.type = opts.type;

  return komainuGet<KomainuPagedResponse<KomainuRequest>>("/v1/requests", params);
}

/**
 * Fetch a single transaction by ID.
 */
export async function fetchTransaction(transactionId: string): Promise<KomainuTransaction> {
  return komainuGet<KomainuTransaction>(`/v1/custody/transactions/${transactionId}`);
}

/**
 * Fetch a single request by ID to check its current status.
 */
export async function fetchRequest(requestId: string): Promise<KomainuRequest> {
  return komainuGet<KomainuRequest>(`/v1/requests/${requestId}`);
}

/**
 * Approve a pending request via the Komainu API.
 * Returns the updated request object.
 */
export async function approveRequest(requestId: string): Promise<KomainuRequest> {
  return komainuPost<KomainuRequest>(`/v1/requests/${requestId}/approve`, "POST");
}

/**
 * Check if the Komainu API is configured.
 */
export function isKomainuConfigured(): boolean {
  return getConfig() !== null;
}
