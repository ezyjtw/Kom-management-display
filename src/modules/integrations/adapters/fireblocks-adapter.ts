/**
 * Fireblocks integration adapter.
 *
 * Provides transaction data fetching and vault account queries via the
 * Fireblocks API, normalized behind the IntegrationAdapter interface.
 */

import { logger } from "@/lib/logger";
import type {
  IntegrationAdapter,
  IntegrationHealth,
  NormalizedEvent,
  NormalizedPayload,
} from "@/modules/integrations/types";

// ---------------------------------------------------------------------------
// Fireblocks types
// ---------------------------------------------------------------------------

interface FireblocksConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
}

interface FireblocksTransaction {
  id: string;
  assetId: string;
  operation: string;
  status: string;
  txHash?: string;
  amount: number;
  fee?: number;
  source: {
    id?: string;
    type: string;
    name?: string;
  };
  destination: {
    id?: string;
    type: string;
    name?: string;
  };
  createdAt: number; // epoch ms
  lastUpdated: number; // epoch ms
  createdBy?: string;
  note?: string;
  subStatus?: string;
}

interface FireblocksVaultAccount {
  id: string;
  name: string;
  assets: Array<{
    id: string;
    total: string;
    available: string;
    pending: string;
    frozen: string;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getConfig(): FireblocksConfig | null {
  const apiKey = process.env.FIREBLOCKS_API_KEY;
  const apiSecret = process.env.FIREBLOCKS_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  return {
    apiKey,
    apiSecret,
    baseUrl: (process.env.FIREBLOCKS_API_BASE_URL ?? "https://api.fireblocks.io").replace(
      /\/+$/,
      "",
    ),
  };
}

/**
 * Sign a Fireblocks API request using JWT.
 * The Fireblocks API uses RS256 JWTs signed with the API secret (private key).
 */
async function signRequest(
  config: FireblocksConfig,
  path: string,
  method: string,
  body?: string,
): Promise<string> {
  const crypto = await import("crypto");
  const now = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();

  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      uri: path,
      nonce,
      iat: now,
      exp: now + 30,
      sub: config.apiKey,
      bodyHash: body
        ? crypto.createHash("sha256").update(body).digest("hex")
        : crypto.createHash("sha256").update("").digest("hex"),
    }),
  ).toString("base64url");

  const signatureInput = `${header}.${payload}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signatureInput);
  const signature = sign.sign(config.apiSecret, "base64url");

  return `${signatureInput}.${signature}`;
}

async function fireblocksFetch<T>(
  config: FireblocksConfig,
  path: string,
  method = "GET",
  body?: Record<string, unknown>,
): Promise<T> {
  const bodyStr = body ? JSON.stringify(body) : undefined;
  const jwt = await signRequest(config, `/v1${path}`, method, bodyStr);

  const res = await fetch(`${config.baseUrl}/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "X-API-Key": config.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: bodyStr,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Fireblocks API ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapTransactionStatus(status: string): string {
  const lower = status.toLowerCase();
  if (["completed", "confirmed"].includes(lower)) return "confirmed";
  if (["submitted", "pending_authorization", "queued"].includes(lower)) return "pending";
  if (["broadcasting"].includes(lower)) return "broadcasting";
  if (["failed", "rejected", "cancelled", "blocked"].includes(lower)) return "failed";
  return lower;
}

function mapTransactionEventType(
  tx: FireblocksTransaction,
): NormalizedEvent["eventType"] {
  const status = tx.status.toLowerCase();
  if (["completed", "confirmed"].includes(status)) return "resolved";
  if (["failed", "rejected", "cancelled"].includes(status)) return "closed";
  if (["pending_authorization"].includes(status)) return "approval_requested";
  return "updated";
}

function mapTransactionToEvent(tx: FireblocksTransaction): NormalizedEvent {
  const payload: NormalizedPayload = {
    subject: `${tx.operation} ${tx.amount} ${tx.assetId}`,
    body: tx.note ?? undefined,
    status: mapTransactionStatus(tx.status),
    actor: tx.createdBy ? { name: tx.createdBy } : undefined,
    metadata: {
      txHash: tx.txHash,
      assetId: tx.assetId,
      operation: tx.operation,
      amount: tx.amount,
      fee: tx.fee,
      sourceType: tx.source.type,
      sourceName: tx.source.name,
      sourceId: tx.source.id,
      destinationType: tx.destination.type,
      destinationName: tx.destination.name,
      destinationId: tx.destination.id,
      subStatus: tx.subStatus,
      fireblocksStatus: tx.status,
    },
  };

  return {
    id: `fireblocks-tx-${tx.id}-${tx.lastUpdated}`,
    sourceSystem: "fireblocks",
    sourceId: tx.id,
    entityType: "transaction",
    eventType: mapTransactionEventType(tx),
    occurredAt: new Date(tx.lastUpdated),
    receivedAt: new Date(),
    payload,
    rawPayload: tx as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class FireblocksAdapter implements IntegrationAdapter {
  readonly source = "fireblocks" as const;

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
      logger.warn("Fireblocks adapter not configured, skipping sync");
      return [];
    }

    const maxRetries = 3;

    try {
      logger.info("Fireblocks sync starting");

      const events: NormalizedEvent[] = [];

      // Fetch recent transactions with retry
      let transactions: FireblocksTransaction[] = [];
      const status = (opts?.status as string) ?? undefined;
      const limit = (opts?.limit as number) ?? 200;
      const queryParams = new URLSearchParams();
      if (status) queryParams.set("status", status);
      queryParams.set("limit", String(limit));
      queryParams.set("orderBy", "lastUpdated");
      queryParams.set("sort", "DESC");

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          transactions = await fireblocksFetch<FireblocksTransaction[]>(
            config,
            `/transactions?${queryParams.toString()}`,
          );
          break;
        } catch (err) {
          if (attempt === maxRetries) throw err;
          const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          logger.warn("Fireblocks fetch retry", { attempt, backoff });
          await sleep(backoff);
        }
      }

      for (const tx of transactions) {
        events.push(mapTransactionToEvent(tx));
      }

      // Optionally fetch vault accounts
      if (opts?.includeVaults) {
        try {
          const vaults = await fireblocksFetch<FireblocksVaultAccount[]>(
            config,
            "/vault/accounts_paged?limit=100",
          );
          logger.info("Fireblocks vaults fetched", { count: vaults.length });
          // Vault data is informational; attach as metadata if needed
        } catch (err) {
          logger.warn("Failed to fetch Fireblocks vaults", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      this.lastSuccessfulSync = new Date();
      this.failureCount = 0;
      logger.info("Fireblocks sync completed", { events: events.length });
      return events;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastFailure = new Date();
      this.lastFailureMessage = message;
      this.failureCount++;
      logger.error("Fireblocks sync failed", {
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
