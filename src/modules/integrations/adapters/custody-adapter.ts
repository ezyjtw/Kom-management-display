/**
 * Custody integration adapter — wraps the read-only Komainu API client.
 */

import { logger } from "@/lib/logger";
import {
  fetchRequests,
  fetchTransactions,
  isKomainuConfigured,
} from "@/lib/integrations/komainu-api/client";
import type { KomainuRequest, KomainuTransaction } from "@/lib/integrations/komainu-api/types";
import type {
  IntegrationAdapter,
  IntegrationHealth,
  NormalizedEvent,
  NormalizedPayload,
} from "@/modules/integrations/types";

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
    id: `custody-tx-${tx.id}-${tx.status}`,
    sourceSystem: "custody",
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
    id: `custody-req-${req.id}-${req.status}`,
    sourceSystem: "custody",
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

export class CustodyAdapter implements IntegrationAdapter {
  readonly source = "custody" as const;

  private lastSuccessfulSync: Date | null = null;
  private lastFailure: Date | null = null;
  private lastFailureMessage?: string;
  private failureCount = 0;

  isConfigured(): boolean {
    return isKomainuConfigured();
  }

  async sync(opts?: Record<string, unknown>): Promise<NormalizedEvent[]> {
    if (!isKomainuConfigured()) {
      logger.warn("Custody adapter not configured, skipping sync");
      return [];
    }

    const maxRetries = 3;

    try {
      logger.info("Custody sync starting");
      const events: NormalizedEvent[] = [];

      // Fetch pending transactions with retry
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const txParams: Record<string, string> = {
            status: (opts?.transactionStatus as string) ?? "PENDING",
          };
          const txResult = await fetchTransactions(txParams);
          for (const tx of txResult.data) {
            events.push(mapTransactionToEvent(tx));
          }
          break;
        } catch (err) {
          if (attempt === maxRetries) throw err;
          const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          logger.warn("Custody transaction fetch retry", { attempt, backoff });
          await sleep(backoff);
        }
      }

      // Fetch pending requests with retry
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const reqParams: Record<string, string> = {
            status: (opts?.requestStatus as string) ?? "PENDING",
          };
          const reqResult = await fetchRequests(reqParams);
          for (const req of reqResult.data) {
            events.push(mapRequestToEvent(req));
          }
          break;
        } catch (err) {
          if (attempt === maxRetries) throw err;
          const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          logger.warn("Custody request fetch retry", { attempt, backoff });
          await sleep(backoff);
        }
      }

      this.lastSuccessfulSync = new Date();
      this.failureCount = 0;
      logger.info("Custody sync completed", { events: events.length });
      return events;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastFailure = new Date();
      this.lastFailureMessage = message;
      this.failureCount++;
      logger.error("Custody sync failed", {
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
