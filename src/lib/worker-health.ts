import { prisma } from "@/lib/prisma";
import { isAnyWorkerAlive } from "@/lib/background-jobs";
import { logger } from "@/lib/logger";

export const WORKER_HEARTBEAT_THRESHOLD_MS = 120_000;
export const WORKER_ALERT_TYPE = "ALR-HB-WORKER";
const WORKER_ALERT_DEDUPE_KEY = "worker";

/**
 * Checked from the web app (not the worker), so it still fires when the worker
 * is dead. Opens one ALR-HB-WORKER alert while no worker is alive and resolves
 * it once a heartbeat returns.
 */
/**
 * The alert is maintained at most once per ALERT_MAINTENANCE_MS per process:
 * every open tab and every platform probe calls /api/health, and each call
 * used to write (load review, Phase 12n). The worker state is still read on
 * every call.
 */
export const ALERT_MAINTENANCE_MS = 60_000;
let lastMaintenance: { at: number; alive: boolean } | null = null;

/** Test hook. */
export function resetWorkerHealthThrottle(): void {
  lastMaintenance = null;
}

export async function checkWorkerHealth(now = Date.now()): Promise<{ workerAlive: boolean }> {
  const workerAlive = await isAnyWorkerAlive(WORKER_HEARTBEAT_THRESHOLD_MS);
  // A change of state is acted on at once; otherwise at most once a minute.
  if (lastMaintenance && lastMaintenance.alive === workerAlive && now - lastMaintenance.at < ALERT_MAINTENANCE_MS) {
    return { workerAlive };
  }
  lastMaintenance = { at: now, alive: workerAlive };

  try {
    if (!workerAlive) {
      const open = await prisma.alert.count({
        where: { ruleCode: WORKER_ALERT_TYPE, dedupeKey: WORKER_ALERT_DEDUPE_KEY, status: { not: "resolved" } },
      });
      if (open === 0) {
        await prisma.alert.create({
          data: {
            type: WORKER_ALERT_TYPE,
            ruleCode: WORKER_ALERT_TYPE,
            dedupeKey: WORKER_ALERT_DEDUPE_KEY,
            severity: "critical",
            priority: "P0",
            message: "Background worker has not sent a heartbeat for over 2 minutes. Alerts and SLA checks are not running.",
          },
        });
        logger.error("ALR-HB-WORKER fired: no live worker heartbeat");
      }
    } else {
      await prisma.alert.updateMany({
        where: { ruleCode: WORKER_ALERT_TYPE, status: { not: "resolved" } },
        data: { status: "resolved", resolvedAt: new Date(), autoResolvedAt: new Date() },
      });
    }
  } catch (error) {
    logger.warn("Could not update worker heartbeat alert", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { workerAlive };
}
