import { prisma } from "@/lib/prisma";
import { isAnyWorkerAlive } from "@/lib/background-jobs";
import { logger } from "@/lib/logger";

export const WORKER_HEARTBEAT_THRESHOLD_MS = 120_000;
export const WORKER_ALERT_TYPE = "ALR-HB-WORKER";

/**
 * Checked from the web app (not the worker), so it still fires when the worker
 * is dead. Opens one ALR-HB-WORKER alert while no worker is alive and resolves
 * it once a heartbeat returns.
 */
export async function checkWorkerHealth(): Promise<{ workerAlive: boolean }> {
  const workerAlive = await isAnyWorkerAlive(WORKER_HEARTBEAT_THRESHOLD_MS);

  try {
    if (!workerAlive) {
      const open = await prisma.alert.count({
        where: { type: WORKER_ALERT_TYPE, status: { not: "resolved" } },
      });
      if (open === 0) {
        await prisma.alert.create({
          data: {
            type: WORKER_ALERT_TYPE,
            severity: "critical",
            priority: "P0",
            message: "Background worker has not sent a heartbeat for over 2 minutes. Alerts and SLA checks are not running.",
          },
        });
        logger.error("ALR-HB-WORKER fired: no live worker heartbeat");
      }
    } else {
      await prisma.alert.updateMany({
        where: { type: WORKER_ALERT_TYPE, status: { not: "resolved" } },
        data: { status: "resolved", resolvedAt: new Date() },
      });
    }
  } catch (error) {
    logger.warn("Could not update worker heartbeat alert", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { workerAlive };
}
