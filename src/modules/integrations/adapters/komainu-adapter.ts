/**
 * Komainu custody integration adapter.
 *
 * Wraps the existing Komainu API client from src/lib/integrations/komainu.ts
 * behind the IntegrationAdapter interface with health tracking.
 */

import { logger } from "@/lib/logger";
import type {
  IntegrationAdapter,
  IntegrationHealth,
  NormalizedEvent,
  NormalizedPayload,
} from "@/modules/integrations/types";

// ---------------------------------------------------------------------------
// Komainu types (mirrors src/lib/integrations/komainu.ts)
// ---------------------------------------------------------------------------

interface KomainuConfig {
  baseUrl: string;
  apiUser: string;
  apiSecret: string;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

interface KomainuTransaction {
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

interface KomainuRequest {
  id: string;
  type: string;
  status: "CREATED" | "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED" | "BLOCKED";
  entity: string;
  entity_id?: string;
  requested_by: string;
  requested_at: string;
  expires_at: string;
  updated_at: string;
  workspace: string;
  organization: string;
  account: string;
}

interface KomainuPagedResponse<T> {
  page: number;
  count: number;
  has_next: boolean;
  data: T[];
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

let tokenCache: TokenCache | null = null;

function getConfig(): KomainuConfig | null {
  const baseUrl = process.env.KOMAINU_API_BASE_URL || process.env.KOMAINU_API_URL;
  const apiUser = process.env.KOMAINU_API_USER || process.env.KOMAINU_API_KEY;
  const apiSecret = process.env.KOMAINU_API_SECRET;
  if (!baseUrl || !apiUser || !apiSecret) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiUser, apiSecret };
}

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

async function komainuGet<T>(
  config: KomainuConfig,
  path: string,
  params?: Record<string, string>,
): Promise<T> {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function mapTransactionToEvent(tx: KomainuTransaction): NormalizedEvent {
  const payload: NormalizedPayload = {
    subject: `${tx.direction} ${tx.amount} ${tx.asset}`,
    body: tx.note || undefined,
    status: tx.status.toLowerCase(),
    actor: tx.created_by ? { name: tx.created_by } : undefined,
    metadata: {
      walletId: tx.wallet_id,
      direction: tx.direction,
      asset: tx.asset,
      amount: tx.amount,
      fees: tx.fees,
      txHash: tx.tx_hash,
      senderAddress: tx.sender_address,
      receiverAddress: tx.receiver_address,
      transactionType: tx.transaction_type,
      workspace: tx.workspace,
      organization: tx.organization,
      account: tx.account,
      externalReference: tx.external_reference,
    },
  };

  let eventType: NormalizedEvent["eventType"] = "updated";
  if (tx.status === "CONFIRMED") eventType = "resolved";
  if (tx.status === "FAILED") eventType = "closed";
  if (tx.status === "PENDING") eventType = "approval_requested";

  return {
    id: `komainu-tx-${tx.id}-${tx.status}`,
    sourceSystem: "komainu",
    sourceId: tx.id,
    entityType: "transaction",
    eventType,
    occurredAt: new Date(tx.created_at),
    receivedAt: new Date(),
    payload,
    rawPayload: tx as unknown as Record<string, unknown>,
  };
}

function mapRequestToEvent(req: KomainuRequest): NormalizedEvent {
  const payload: NormalizedPayload = {
    subject: `${req.type} request (${req.entity})`,
    status: req.status.toLowerCase(),
    actor: { name: req.requested_by },
    metadata: {
      requestType: req.type,
      entity: req.entity,
      entityId: req.entity_id,
      workspace: req.workspace,
      organization: req.organization,
      account: req.account,
      expiresAt: req.expires_at,
    },
  };

  let eventType: NormalizedEvent["eventType"] = "approval_requested";
  if (req.status === "APPROVED") eventType = "approval_granted";
  if (req.status === "REJECTED") eventType = "approval_rejected";
  if (["CANCELLED", "EXPIRED", "BLOCKED"].includes(req.status)) eventType = "closed";

  return {
    id: `komainu-req-${req.id}-${req.status}`,
    sourceSystem: "komainu",
    sourceId: req.id,
    entityType: "approval",
    eventType,
    occurredAt: new Date(req.updated_at),
    receivedAt: new Date(),
    payload,
    rawPayload: req as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class KomainuAdapter implements IntegrationAdapter {
  readonly source = "komainu" as const;

  private lastSuccessfulSync: Date | null = null;
  private lastFailure: Date | null = null;
  private lastFailureMessage?: string;
  private failureCount = 0;

  isConfigured(): boolean {
    return getConfig() !== null;
  }

  async sync(opts?: Record<string, unknown>): Promise<NormalizedEvent[]> {
    const config = getConfig();
    if (!config) {
      logger.warn("Komainu adapter not configured, skipping sync");
      return [];
    }

    const maxRetries = 3;

    try {
      logger.info("Komainu sync starting");
      const events: NormalizedEvent[] = [];

      // Fetch pending transactions with retry
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const txParams: Record<string, string> = {
            status: (opts?.transactionStatus as string) ?? "PENDING",
          };
          const txResult = await komainuGet<KomainuPagedResponse<KomainuTransaction>>(
            config,
            "/v1/custody/transactions",
            txParams,
          );
          for (const tx of txResult.data) {
            events.push(mapTransactionToEvent(tx));
          }
          break;
        } catch (err) {
          if (attempt === maxRetries) throw err;
          const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          logger.warn("Komainu transaction fetch retry", { attempt, backoff });
          await sleep(backoff);
        }
      }

      // Fetch pending requests with retry
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const reqParams: Record<string, string> = {
            status: (opts?.requestStatus as string) ?? "PENDING",
          };
          const reqResult = await komainuGet<KomainuPagedResponse<KomainuRequest>>(
            config,
            "/v1/requests",
            reqParams,
          );
          for (const req of reqResult.data) {
            events.push(mapRequestToEvent(req));
          }
          break;
        } catch (err) {
          if (attempt === maxRetries) throw err;
          const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          logger.warn("Komainu request fetch retry", { attempt, backoff });
          await sleep(backoff);
        }
      }

      this.lastSuccessfulSync = new Date();
      this.failureCount = 0;
      logger.info("Komainu sync completed", { events: events.length });
      return events;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastFailure = new Date();
      this.lastFailureMessage = message;
      this.failureCount++;
      logger.error("Komainu sync failed", {
        error: message,
        failureCount: this.failureCount,
      });
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
      failureCount: this.failureCount,
      status,
    };
  }
}
