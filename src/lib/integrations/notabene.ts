/**
 * Notabene Travel Rule API client.
 *
 * Auth: Bearer token (API key)
 * Transfers: GET /tf/transfers — list transfers
 *            GET /tf/transfers/:id — single transfer
 */

import type { NotabeneTransfer } from "@/types";
import { env } from "@/lib/env";

interface NotabeneConfig {
  baseUrl: string;
  apiToken: string;
  vaspDid: string;
}

function getConfig(): NotabeneConfig | null {
  const baseUrl = env("NOTABENE_API_BASE_URL");
  const apiToken = env("NOTABENE_API_TOKEN");
  const vaspDid = env("NOTABENE_VASP_DID");
  if (!baseUrl || !apiToken || !vaspDid) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiToken, vaspDid };
}

async function notabeneFetch<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const config = getConfig();
  if (!config) {
    throw new Error(
      "Notabene not configured: NOTABENE_API_BASE_URL, NOTABENE_API_TOKEN, and NOTABENE_VASP_DID are required",
    );
  }

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface NotabeneListResponse {
  documents: NotabeneTransfer[];
  total: number;
}

/**
 * Fetch recent travel-rule transfers involving our VASP.
 * Both sent (originator) and received (beneficiary) directions.
 */
export async function fetchTransfers(
  opts: { page?: number; perPage?: number; status?: string } = {},
): Promise<{ transfers: NotabeneTransfer[]; total: number }> {
  const config = getConfig();
  if (!config) {
    throw new Error("Notabene not configured");
  }

  const params: Record<string, string> = {
    vasp_did: config.vaspDid,
    per_page: String(opts.perPage ?? 200),
    page: String(opts.page ?? 0),
  };
  if (opts.status) params.status = opts.status;

  const result = await notabeneFetch<NotabeneListResponse>(
    "/tf/transfers",
    params,
  );

  return { transfers: result.documents ?? [], total: result.total ?? 0 };
}

/**
 * Fetch a single transfer by ID.
 */
export async function fetchTransfer(
  transferId: string,
): Promise<NotabeneTransfer> {
  return notabeneFetch<NotabeneTransfer>(`/tf/transfers/${transferId}`);
}

// ---------------------------------------------------------------------------
// Supported Assets API
// ---------------------------------------------------------------------------

export interface NotabeneAsset {
  asset_type: string;
  notabene_asset: string;
  notabene_description: string;
  decimals: number;
  coingecko_id: string | null;
  notabene_network: string;
  /** Analytics provider mappings */
  elliptic_id?: string | null;
  trm_id?: string | null;
  chainalysis_id?: string | null;
  coinfirm_id?: string | null;
  crystal_id?: string | null;
  coinmarketcap_id?: string | null;
}

interface NotabeneAssetsResponse {
  assets: NotabeneAsset[];
  total?: number;
}

/**
 * Fetch all supported assets from the Notabene Asset Service.
 * Endpoint: GET /v1/assets/assets
 */
export async function fetchSupportedAssets(): Promise<NotabeneAsset[]> {
  const config = getConfig();
  if (!config) {
    throw new Error("Notabene not configured");
  }

  // The assets endpoint is on the main API host
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const url = new URL(`${baseUrl}/v1/assets/assets`);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(
      `Notabene Assets API ${res.status}: ${await res.text().catch(() => res.statusText)}`,
    );
  }

  const data = await res.json();
  // Response may be an array directly or { assets: [...] }
  if (Array.isArray(data)) return data as NotabeneAsset[];
  return (data as NotabeneAssetsResponse).assets ?? [];
}

/**
 * Search for a single asset by its Notabene asset identifier (e.g. "eth", "USDC-SOL").
 * Endpoint: GET /v1/assets/asset?notabeneAsset=<identifier>
 */
export async function fetchAssetByIdentifier(
  notabeneAsset: string,
): Promise<NotabeneAsset | null> {
  const config = getConfig();
  if (!config) {
    throw new Error("Notabene not configured");
  }

  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const url = new URL(`${baseUrl}/v1/assets/asset`);
  url.searchParams.set("notabeneAsset", notabeneAsset);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      Accept: "application/json",
    },
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    throw new Error(
      `Notabene Asset API ${res.status}: ${await res.text().catch(() => res.statusText)}`,
    );
  }

  return res.json() as Promise<NotabeneAsset>;
}

/**
 * Check if Notabene is configured.
 */
export function isNotabeneConfigured(): boolean {
  return getConfig() !== null;
}

/**
 * Extract a human-readable name from a NotabeneParty originator/beneficiary.
 */
export function extractPartyName(
  party: NotabeneTransfer["originator"] | NotabeneTransfer["beneficiary"],
  role: "originator" | "beneficiary",
): string | null {
  if (!party) return null;

  const persons =
    role === "originator"
      ? party.originatorPersons
      : party.beneficiaryPersons;

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

/**
 * Return true when the originator data is considered "present" for compliance.
 */
export function hasOriginatorData(transfer: NotabeneTransfer): boolean {
  if (!transfer.originator) return false;
  return extractPartyName(transfer.originator, "originator") !== null;
}

/**
 * Return true when the beneficiary data is considered "present" for compliance.
 */
export function hasBeneficiaryData(transfer: NotabeneTransfer): boolean {
  if (!transfer.beneficiary) return false;
  return extractPartyName(transfer.beneficiary, "beneficiary") !== null;
}
