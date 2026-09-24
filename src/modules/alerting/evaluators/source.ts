/**
 * Read helpers over SourceRecord snapshots written by the pollers (spec §8.1).
 * Field names follow the custody API payloads as stored; the ones not yet in
 * the committed OpenAPI file are looked up under several candidate names.
 * TODO(CONFIRM-CUSTODY-OPENAPI): pin these to the schema once it is committed.
 */

import type { SourceRecord } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type Rec = Pick<SourceRecord, "externalId" | "status" | "mappedStatus" | "occurredAt" | "sourceUpdatedAt" | "lastSeenAt" | "fields" | "credentialLabel">;

const SELECT = { externalId: true, status: true, mappedStatus: true, occurredAt: true, sourceUpdatedAt: true, lastSeenAt: true, fields: true, credentialLabel: true } as const;

export function fieldsOf(r: Pick<SourceRecord, "fields">): Record<string, unknown> {
  return r.fields && typeof r.fields === "object" && !Array.isArray(r.fields) ? (r.fields as Record<string, unknown>) : {};
}

/** First string (or number) value among candidate field names. */
export function pick(r: Pick<SourceRecord, "fields">, ...names: string[]): string | null {
  const f = fieldsOf(r);
  for (const n of names) {
    const v = f[n];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

export function pickNumber(r: Pick<SourceRecord, "fields">, ...names: string[]): number | null {
  const f = fieldsOf(r);
  for (const n of names) {
    const v = f[n];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

export function custodyRecords(kind: string, where: Record<string, unknown> = {}): Promise<Rec[]> {
  return prisma.sourceRecord.findMany({ where: { source: "custody_api", kind, ...where }, select: SELECT, take: 5000 });
}

/** Records the latest poll still returned (not marked no_longer_listed). */
export const stillListed = { OR: [{ mappedStatus: null }, { mappedStatus: { not: "no_longer_listed" } }] };

export const minsSince = (d: Date | null | undefined, now: Date) => (d ? (now.getTime() - d.getTime()) / 60_000 : 0);
