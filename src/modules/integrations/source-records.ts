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

/** Upsert the latest known state of each record; firstSeenAt is kept, lastSeenAt refreshed. */
export async function upsertSourceRecords(source: string, kind: string, records: SourceRecordInput[]): Promise<number> {
  const now = new Date();
  for (const r of records) {
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
  }
  return records.length;
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
