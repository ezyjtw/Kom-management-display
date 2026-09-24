/**
 * custody API pollers (spec §8.1). Each poll aggregates across every
 * configured API credential, stores a minimal snapshot per record in
 * SourceRecord, and updates SourceHeartbeat.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  fetchAllPages,
  forEachCredential,
  custodyGet,
  type CustodyCredential,
} from "@/lib/integrations/custody-api/client";
import type { CustodyRequest, CustodyTransaction } from "@/lib/integrations/custody-api/types";
import { recordHeartbeat } from "@/modules/integrations/heartbeat";
import { newestTimestamp, upsertSourceRecords, type SourceRecordInput } from "@/modules/integrations/source-records";
import { mapStatuses, type StatusEntity } from "@/modules/integrations/custody/status-map";

export const SOURCE = "custody_api";

/** Heartbeat sources and their expected cadence (minutes). */
export const CUSTODY_HEARTBEATS = {
  requests: { source: "custody_api.requests", expectedEveryMins: 1 },
  transactions: { source: "custody_api.transactions", expectedEveryMins: 2 },
  collateral: { source: "custody_api.collateral", expectedEveryMins: 10 },
  auditLogs: { source: "custody_api.audit_logs", expectedEveryMins: 5 },
  eodBalances: { source: "custody_api.eod_balances", expectedEveryMins: 24 * 60 },
  staking: { source: "custody_api.staking", expectedEveryMins: 24 * 60 },
  stakes: { source: "custody_api.stakes", expectedEveryMins: 24 * 60 },
} as const;

const date = (v: unknown): Date | null => {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const SENSITIVE_KEY = /(address|hash|secret|token|key|signature|iban|memo|note)/i;

/**
 * For endpoints whose schema is not yet in the repo, keep scalar fields only,
 * dropping anything that looks sensitive (H8).
 * TODO(CONFIRM-CUSTODY-OPENAPI): replace with a per-endpoint allowlist once
 * docs/phase1/custody-openapi-1.6.0.json is committed.
 */
export function safeScalarFields(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (SENSITIVE_KEY.test(k)) continue;
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) out[k] = v;
  }
  return out;
}

export function requestToRecord(r: CustodyRequest, label: string): SourceRecordInput {
  return {
    externalId: r.id,
    credentialLabel: label,
    status: r.status,
    occurredAt: date(r.requested_at),
    sourceUpdatedAt: date(r.updated_at),
    fields: {
      type: r.type,
      entity: r.entity,
      entityId: r.entity_id ?? null,
      requestedAt: r.requested_at,
      expiresAt: r.expires_at,
      organization: r.organization,
      account: r.account,
      workspace: r.workspace,
    },
  };
}

export function transactionToRecord(t: CustodyTransaction, label: string): SourceRecordInput {
  return {
    externalId: t.id,
    credentialLabel: label,
    status: t.status,
    occurredAt: date(t.created_at),
    fields: {
      direction: t.direction,
      asset: t.asset,
      amount: t.amount,
      transactionType: t.transaction_type,
      walletId: t.wallet_id,
      organization: t.organization,
      account: t.account,
      workspace: t.workspace,
      externalReference: t.external_reference,
    },
  };
}

/**
 * Records previously in one of `statuses` that this poll did not return have
 * left that set (e.g. no longer PENDING). Marked so rules can tell.
 */
async function markNoLongerListed(kind: string, statuses: string[], seenIds: string[], labels: string[], since: Date) {
  if (labels.length === 0) return;
  await prisma.sourceRecord.updateMany({
    where: {
      source: SOURCE,
      kind,
      status: { in: statuses },
      credentialLabel: { in: labels },
      externalId: { notIn: seenIds },
      lastSeenAt: { lt: since },
      NOT: { mappedStatus: "no_longer_listed" },
    },
    data: { mappedStatus: "no_longer_listed" },
  });
}

async function pollByStatus<T>(
  kind: string,
  path: string,
  statuses: string[],
  toRecord: (item: T, label: string) => SourceRecordInput,
  heartbeat: { source: string; expectedEveryMins: number },
  pageLimit?: (cred: CustodyCredential, status: string) => Promise<T[]>,
) {
  const started = new Date();
  const { results, errors } = await forEachCredential<SourceRecordInput>(async (cred) => {
    const out: SourceRecordInput[] = [];
    for (const status of statuses) {
      const items = pageLimit ? await pageLimit(cred, status) : await fetchAllPages<T>(path, { status }, cred);
      out.push(...items.map((i) => toRecord(i, cred.label)));
    }
    return out;
  });
  const records = results.flatMap((r) => r.items);
  await upsertSourceRecords(SOURCE, kind, records);
  await markNoLongerListed(kind, statuses, records.map((r) => r.externalId), results.map((r) => r.label), started);
  if (errors.length) logger.warn("the custody provider poll had credential errors", { kind, errors: errors.map((e) => e.label) });
  if (results.length > 0) await recordHeartbeat(heartbeat.source, { count: records.length, newestRecordAt: newestTimestamp(records), expectedEveryMins: heartbeat.expectedEveryMins });
  if (results.length === 0 && errors.length) throw new Error(`the custody provider ${kind} poll failed for every credential`);
  return { kind, count: records.length, credentialErrors: errors.length };
}

export function pollRequests() {
  // CREATED and BLOCKED too, for CHK-03 Outstanding Requests in Platform (spec §12). Read-only (H1).
  return pollByStatus<CustodyRequest>("request", "/v1/requests", ["PENDING", "CREATED", "BLOCKED"], requestToRecord, CUSTODY_HEARTBEATS.requests);
}

export function pollTransactions() {
  return pollByStatus<CustodyTransaction>(
    "transaction",
    "/v1/custody/transactions",
    ["PENDING", "BROADCASTED", "FAILED"],
    transactionToRecord,
    CUSTODY_HEARTBEATS.transactions,
    // FAILED is unbounded history: read the first page only.
    // TODO(CONFIRM-CUSTODY-OPENAPI): confirm ordering / a date filter for FAILED.
    async (cred, status) =>
      status === "FAILED"
        ? (await custodyGet<{ data: CustodyTransaction[] }>("/v1/custody/transactions", { status, page: "1", page_size: "100" }, cred)).data ?? []
        : fetchAllPages<CustodyTransaction>("/v1/custody/transactions", { status }, cred),
  );
}

async function pollMapped(kind: string, entity: StatusEntity, path: string) {
  const { results, errors } = await forEachCredential<Record<string, unknown> & { __label: string }>(async (cred) =>
    (await fetchAllPages<Record<string, unknown>>(path, {}, cred)).map((r) => ({ ...r, __label: cred.label })),
  );
  const raw = results.flatMap((r) => r.items);
  const mapping = await mapStatuses(entity, raw.map((r) => (typeof r.status === "string" ? r.status : null)));
  const records: SourceRecordInput[] = raw
    .filter((r) => typeof r.id === "string" || typeof r.id === "number")
    .map(({ __label, ...r }) => ({
      externalId: String(r.id),
      credentialLabel: __label,
      status: typeof r.status === "string" ? r.status : null,
      mappedStatus: typeof r.status === "string" ? mapping.get(r.status) ?? "unknown" : null,
      occurredAt: date(r.started_at) ?? date(r.created_at),
      sourceUpdatedAt: date(r.completed_at) ?? date(r.updated_at),
      fields: safeScalarFields(r),
    }));
  await upsertSourceRecords(SOURCE, kind, records);
  return { records, ok: results.length > 0, errors };
}

/** Settlements, collateral operations and portfolios (OES monitoring). */
export async function pollCollateral() {
  const parts = await Promise.all([
    pollMapped("settlement", "settlement", "/v1/collateral/settlements"),
    pollMapped("collateral_operation", "collateral_operation", "/v1/collateral/operations"),
    pollMapped("portfolio", "portfolio", "/v1/collateral/portfolios"),
  ]);
  const all = parts.flatMap((p) => p.records);
  if (parts.some((p) => p.ok)) {
    await recordHeartbeat(CUSTODY_HEARTBEATS.collateral.source, {
      count: all.length,
      newestRecordAt: newestTimestamp(all),
      expectedEveryMins: CUSTODY_HEARTBEATS.collateral.expectedEveryMins,
    });
  } else if (parts.some((p) => p.errors.length)) {
    throw new Error("the custody provider collateral poll failed for every credential");
  }
  return { settlements: parts[0].records.length, operations: parts[1].records.length, portfolios: parts[2].records.length };
}

/** Audit logs: sliding 10-minute window polled every 5 minutes (max 31-day window per the API). */
export async function pollAuditLogs(now = new Date()) {
  const start = new Date(now.getTime() - 10 * 60_000);
  const { results, errors } = await forEachCredential<SourceRecordInput>(async (cred) => {
    const out: SourceRecordInput[] = [];
    for (const category of ["ADMINISTRATION", "TRANSACTIONS"]) {
      // TODO(CONFIRM-CUSTODY-OPENAPI): cursor pagination parameter; first page only until confirmed.
      const res = await custodyGet<{ data?: Array<Record<string, unknown>> }>(
        "/v1/audit-logs",
        { start_time: start.toISOString(), end_time: now.toISOString(), category },
        cred,
      );
      for (const r of res.data ?? []) {
        if (typeof r.id !== "string" && typeof r.id !== "number") continue;
        out.push({
          externalId: String(r.id),
          credentialLabel: cred.label,
          status: category,
          occurredAt: date(r.created_at) ?? date(r.timestamp),
          fields: safeScalarFields(r),
        });
      }
    }
    return out;
  });
  const records = results.flatMap((r) => r.items);
  await upsertSourceRecords(SOURCE, "audit_log", records);
  if (results.length > 0) {
    await recordHeartbeat(CUSTODY_HEARTBEATS.auditLogs.source, { count: records.length, newestRecordAt: newestTimestamp(records), expectedEveryMins: CUSTODY_HEARTBEATS.auditLogs.expectedEveryMins });
  } else if (errors.length) {
    throw new Error("the custody provider audit-log poll failed for every credential");
  }
  return { count: records.length };
}

async function pollDaily(kind: string, path: string, hb: { source: string; expectedEveryMins: number }, idOf: (r: Record<string, unknown>) => string | null) {
  const { results, errors } = await forEachCredential<SourceRecordInput>(async (cred) =>
    (await fetchAllPages<Record<string, unknown>>(path, {}, cred)).flatMap((r) => {
      const id = idOf(r);
      return id ? [{ externalId: id, credentialLabel: cred.label, fields: safeScalarFields(r), occurredAt: date(r.date) ?? date(r.created_at) }] : [];
    }),
  );
  const records = results.flatMap((r) => r.items);
  await upsertSourceRecords(SOURCE, kind, records);
  if (results.length > 0) await recordHeartbeat(hb.source, { count: records.length, newestRecordAt: newestTimestamp(records), expectedEveryMins: hb.expectedEveryMins });
  else if (errors.length) throw new Error(`the custody provider ${kind} poll failed for every credential`);
  return { count: records.length };
}

/** EOD balances (MTD and staking support), daily at 07:00 UTC. */
export function pollEodBalances() {
  // TODO(CONFIRM-CUSTODY-OPENAPI): confirm the record identity fields.
  return pollDaily("eod_balance", "/v1/custody/wallets/eodbalances", CUSTODY_HEARTBEATS.eodBalances, (r) =>
    r.id !== undefined ? String(r.id) : r.wallet_id && r.date ? `${String(r.wallet_id)}:${String(r.date)}` : null,
  );
}

/** Daily staking rewards, 07:30 UTC. */
export function pollStakingRewards() {
  // TODO(CONFIRM-CUSTODY-OPENAPI): confirm the record identity fields.
  return pollDaily("staking_reward", "/v1/staking/rewards/daily", CUSTODY_HEARTBEATS.staking, (r) =>
    r.id !== undefined ? String(r.id) : r.wallet_id && r.date ? `${String(r.wallet_id)}:${String(r.date)}` : null,
  );
}

/** ETH and SOL stakes (CHK-22 newly staked accounts; CHK-16/17). Daily. */
export async function pollStakes() {
  // TODO(CONFIRM-CUSTODY-OPENAPI): confirm the stake identity fields.
  const idOf = (chain: string) => (r: Record<string, unknown>) =>
    r.id !== undefined ? `${chain}:${String(r.id)}` : r.wallet_id && r.validator ? `${chain}:${String(r.wallet_id)}:${String(r.validator)}` : null;
  const eth = await pollDaily("stake", "/v1/staking/ethereum/stakes", CUSTODY_HEARTBEATS.stakes, idOf("ethereum"));
  const sol = await pollDaily("stake", "/v1/staking/solana/stakes", CUSTODY_HEARTBEATS.stakes, idOf("solana"));
  return { ethereum: eth.count, solana: sol.count };
}
