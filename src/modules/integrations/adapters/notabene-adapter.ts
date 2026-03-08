/**
 * Notabene travel-rule integration adapter.
 *
 * Wraps the existing Notabene API client from src/lib/integrations/notabene.ts
 * behind the IntegrationAdapter interface with transfer status queries,
 * VASP directory queries, and health tracking.
 */

import { logger } from "@/lib/logger";
import type {
  IntegrationAdapter,
  IntegrationHealth,
  NormalizedEvent,
  NormalizedPayload,
} from "@/modules/integrations/types";

// ---------------------------------------------------------------------------
// Notabene types
// ---------------------------------------------------------------------------

interface NotabeneConfig {
  baseUrl: string;
  apiToken: string;
  vaspDid: string;
}

interface NotabeneTransfer {
  id: string;
  status: string;
  transactionAsset: string;
  transactionAmount: string;
  transactionHash: string | null;
  originatorVASPdid: string;
  beneficiaryVASPdid: string;
  originator: NotabeneParty | null;
  beneficiary: NotabeneParty | null;
  createdAt: string;
  updatedAt: string;
}

interface NotabeneParty {
  originatorPersons?: NotabenePerson[];
  beneficiaryPersons?: NotabenePerson[];
  accountNumber?: string[];
}

interface NotabenePerson {
  naturalPerson?: {
    name: Array<{
      nameIdentifier: Array<{
        primaryIdentifier: string;
        secondaryIdentifier?: string;
      }>;
    }>;
  };
  legalPerson?: {
    name: Array<{
      nameIdentifier: Array<{ legalPersonName: string }>;
    }>;
  };
}

interface NotabeneListResponse {
  documents: NotabeneTransfer[];
  total: number;
}

interface NotabeneVasp {
  did: string;
  name: string;
  website?: string;
  country?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getConfig(): NotabeneConfig | null {
  const baseUrl = process.env.NOTABENE_API_BASE_URL;
  const apiToken = process.env.NOTABENE_API_TOKEN || process.env.NOTABENE_API_KEY;
  const vaspDid = process.env.NOTABENE_VASP_DID;
  if (!baseUrl || !apiToken || !vaspDid) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiToken, vaspDid };
}

async function notabeneFetch<T>(
  config: NotabeneConfig,
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${config.baseUrl}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(
      `Notabene API ${res.status}: ${await res.text().catch(() => res.statusText)}`,
    );
  }

  return res.json() as Promise<T>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract a human-readable name from a party (originator or beneficiary).
 */
function extractPartyName(
  party: NotabeneParty | null,
  role: "originator" | "beneficiary",
): string | null {
  if (!party) return null;

  const persons =
    role === "originator" ? party.originatorPersons : party.beneficiaryPersons;
  if (!persons || persons.length === 0) return null;

  for (const person of persons) {
    if (person.naturalPerson?.name) {
      for (const n of person.naturalPerson.name) {
        for (const id of n.nameIdentifier) {
          const parts = [id.secondaryIdentifier, id.primaryIdentifier]
            .filter(Boolean)
            .join(" ");
          if (parts) return parts;
        }
      }
    }
    if (person.legalPerson?.name) {
      for (const n of person.legalPerson.name) {
        for (const id of n.nameIdentifier) {
          if (id.legalPersonName) return id.legalPersonName;
        }
      }
    }
  }

  return null;
}

function mapTransferEventType(status: string): NormalizedEvent["eventType"] {
  const lower = status.toLowerCase();
  if (["accepted", "ack"].includes(lower)) return "resolved";
  if (["rejected", "cancelled"].includes(lower)) return "closed";
  if (["sent"].includes(lower)) return "updated";
  if (["new", "incomplete"].includes(lower)) return "created";
  return "updated";
}

function mapTransferToEvent(transfer: NotabeneTransfer): NormalizedEvent {
  const originatorName = extractPartyName(transfer.originator, "originator");
  const beneficiaryName = extractPartyName(transfer.beneficiary, "beneficiary");

  const participants: NormalizedPayload["participants"] = [];
  if (originatorName) {
    participants.push({ name: originatorName, role: "originator" });
  }
  if (beneficiaryName) {
    participants.push({ name: beneficiaryName, role: "beneficiary" });
  }

  const payload: NormalizedPayload = {
    subject: `Transfer ${transfer.transactionAmount} ${transfer.transactionAsset}`,
    status: transfer.status.toLowerCase(),
    participants,
    metadata: {
      transactionAsset: transfer.transactionAsset,
      transactionAmount: transfer.transactionAmount,
      transactionHash: transfer.transactionHash,
      originatorVASP: transfer.originatorVASPdid,
      beneficiaryVASP: transfer.beneficiaryVASPdid,
      originatorName,
      beneficiaryName,
      hasOriginator: originatorName !== null,
      hasBeneficiary: beneficiaryName !== null,
    },
  };

  return {
    id: `notabene-${transfer.id}-${transfer.updatedAt}`,
    sourceSystem: "notabene",
    sourceId: transfer.id,
    entityType: "transfer",
    eventType: mapTransferEventType(transfer.status),
    occurredAt: new Date(transfer.updatedAt),
    receivedAt: new Date(),
    payload,
    rawPayload: transfer as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class NotabeneAdapter implements IntegrationAdapter {
  readonly source = "notabene" as const;

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
      logger.warn("Notabene adapter not configured, skipping sync");
      return [];
    }

    const maxRetries = 3;

    try {
      logger.info("Notabene sync starting");

      const params: Record<string, string> = {
        vasp_did: config.vaspDid,
        per_page: String((opts?.perPage as number) ?? 200),
        page: String((opts?.page as number) ?? 0),
      };
      if (opts?.status) params.status = opts.status as string;

      let result: NotabeneListResponse | null = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          result = await notabeneFetch<NotabeneListResponse>(
            config,
            "/tf/transfers",
            params,
          );
          break;
        } catch (err) {
          if (attempt === maxRetries) throw err;
          const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          logger.warn("Notabene fetch retry", { attempt, backoff });
          await sleep(backoff);
        }
      }

      const transfers = result?.documents ?? [];
      const events = transfers.map(mapTransferToEvent);

      // Optionally query the VASP directory
      if (opts?.queryVaspDid) {
        try {
          const vasp = await notabeneFetch<NotabeneVasp>(
            config,
            `/v1/vasps/${opts.queryVaspDid as string}`,
          );
          logger.info("Notabene VASP lookup", {
            did: vasp.did,
            name: vasp.name,
            country: vasp.country,
          });
        } catch (err) {
          logger.warn("Notabene VASP lookup failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      this.lastSuccessfulSync = new Date();
      this.failureCount = 0;
      logger.info("Notabene sync completed", {
        total: result?.total ?? 0,
        events: events.length,
      });
      return events;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastFailure = new Date();
      this.lastFailureMessage = message;
      this.failureCount++;
      logger.error("Notabene sync failed", {
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
