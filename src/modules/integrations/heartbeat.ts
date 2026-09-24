import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Record a successful poll of a source (spec §7.5). `newestRecordAt` is the
 * newest source timestamp seen, if any; it never moves backwards.
 */
export async function recordHeartbeat(
  source: string,
  opts: { count: number; newestRecordAt?: Date | null; expectedEveryMins: number },
): Promise<void> {
  try {
    const existing = await prisma.sourceHeartbeat.findUnique({ where: { source } });
    const newest =
      opts.newestRecordAt && (!existing?.lastRecordAt || opts.newestRecordAt > existing.lastRecordAt)
        ? opts.newestRecordAt
        : existing?.lastRecordAt ?? null;
    await prisma.sourceHeartbeat.upsert({
      where: { source },
      update: { lastSuccessAt: new Date(), lastRecordAt: newest, lastCount: opts.count, expectedEveryMins: opts.expectedEveryMins },
      create: { source, lastSuccessAt: new Date(), lastRecordAt: newest, lastCount: opts.count, expectedEveryMins: opts.expectedEveryMins },
    });
  } catch (error) {
    logger.warn("Failed to record source heartbeat", {
      source,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
