import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/** Record one polling cycle (spec §13.2 polling health). Never throws. */
export async function recordPollCycle(source: string, startedAt: Date, ok: boolean, count: number, error: string | null): Promise<void> {
  try {
    await prisma.pollCycle.create({ data: { source, startedAt, finishedAt: new Date(), ok, count, error } });
  } catch (e) {
    logger.warn("Could not record poll cycle", { source, error: e instanceof Error ? e.message : String(e) });
  }
}

/** Drop cycle records older than the retention window (default 90 days). */
export async function prunePollCycles(now = new Date(), days = 90): Promise<number> {
  const { count } = await prisma.pollCycle.deleteMany({ where: { startedAt: { lt: new Date(now.getTime() - days * 86_400_000) } } });
  return count;
}
