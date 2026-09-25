import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface SourceRecordInput {
  externalId: string;
  credentialLabel?: string;
  status?: string | null;
  mappedStatus?: string | null;
  occurredAt?: Date | null;
  sourceUpdatedAt?: Date | null;
  /** Only the fields a rule needs (spec §8.1 data handling). */
  fields?: Record<string, unknown>;
}

const LOOKUP_CHUNK = 1000;

/** Key order does not matter; dates compare by instant. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );
}

const time = (d: Date | null | undefined) => (d ? new Date(d).getTime() : null);

type Stored = { externalId: string; credentialLabel: string; status: string | null; mappedStatus: string | null; occurredAt: Date | null; sourceUpdatedAt: Date | null; fields: unknown };

/** True when a poll returned exactly what is already stored (so only lastSeenAt needs to move). */
export function unchanged(stored: Stored, r: SourceRecordInput): boolean {
  return (
    stored.credentialLabel === (r.credentialLabel ?? "") &&
    stored.status === (r.status ?? null) &&
    stored.mappedStatus === (r.mappedStatus ?? null) &&
    time(stored.occurredAt) === time(r.occurredAt) &&
    time(stored.sourceUpdatedAt) === time(r.sourceUpdatedAt) &&
    stable(stored.fields ?? {}) === stable(r.fields ?? {})
  );
}

/** External ids that are new or differ from what is stored (no writes). */
export async function changedExternalIds(source: string, kind: string, records: SourceRecordInput[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < records.length; i += LOOKUP_CHUNK) {
    const chunk = records.slice(i, i + LOOKUP_CHUNK);
    const stored = await prisma.sourceRecord.findMany({
      where: { source, kind, externalId: { in: chunk.map((r) => r.externalId) } },
      select: { externalId: true, credentialLabel: true, status: true, mappedStatus: true, occurredAt: true, sourceUpdatedAt: true, fields: true },
    });
    const byId = new Map((stored as Stored[]).map((s) => [s.externalId, s]));
    for (const r of chunk) {
      const existing = byId.get(r.externalId);
      if (!existing || !unchanged(existing, r)) out.add(r.externalId);
    }
  }
  return out;
}

/**
 * Store the latest known state of each record; firstSeenAt is kept, lastSeenAt
 * refreshed. A poll mostly returns records that have not changed, so those get
 * one bulk lastSeenAt update per chunk instead of a write each; only new or
 * changed records are written individually (load review, Phase 12n).
 */
export async function upsertSourceRecords(source: string, kind: string, records: SourceRecordInput[]): Promise<{ total: number; written: number }> {
  const now = new Date();
  let written = 0;
  for (let i = 0; i < records.length; i += LOOKUP_CHUNK) {
    const chunk = records.slice(i, i + LOOKUP_CHUNK);
    const stored = await prisma.sourceRecord.findMany({
      where: { source, kind, externalId: { in: chunk.map((r) => r.externalId) } },
      select: { externalId: true, credentialLabel: true, status: true, mappedStatus: true, occurredAt: true, sourceUpdatedAt: true, fields: true },
    });
    const byId = new Map((stored as Stored[]).map((s) => [s.externalId, s]));
    const same: string[] = [];
    for (const r of chunk) {
      const existing = byId.get(r.externalId);
      if (existing && unchanged(existing, r)) {
        same.push(r.externalId);
        continue;
      }
      const data = {
        credentialLabel: r.credentialLabel ?? "",
        status: r.status ?? null,
        mappedStatus: r.mappedStatus ?? null,
        occurredAt: r.occurredAt ?? null,
        sourceUpdatedAt: r.sourceUpdatedAt ?? null,
        fields: (r.fields ?? {}) as Prisma.InputJsonValue,
        lastSeenAt: now,
      };
      await prisma.sourceRecord.upsert({
        where: { source_kind_externalId: { source, kind, externalId: r.externalId } },
        update: data,
        create: { source, kind, externalId: r.externalId, ...data },
      });
      written++;
    }
    if (same.length) {
      await prisma.sourceRecord.updateMany({ where: { source, kind, externalId: { in: same } }, data: { lastSeenAt: now } });
    }
  }
  return { total: records.length, written };
}

/** Newest timestamp among records, for SourceHeartbeat.lastRecordAt. */
export function newestTimestamp(records: SourceRecordInput[]): Date | null {
  let newest: Date | null = null;
  for (const r of records) {
    const t = r.sourceUpdatedAt ?? r.occurredAt;
    if (t && (!newest || t > newest)) newest = t;
  }
  return newest;
}
