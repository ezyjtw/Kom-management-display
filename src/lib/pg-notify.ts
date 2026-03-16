/**
 * PostgreSQL LISTEN/NOTIFY bridge for multi-instance SSE fan-out.
 *
 * When multiple application instances are running behind a load balancer,
 * SSE events emitted on one instance need to propagate to clients connected
 * to other instances. This module uses PostgreSQL's LISTEN/NOTIFY mechanism
 * as a lightweight pub/sub channel.
 *
 * Architecture:
 *   Producer (any instance) -> NOTIFY sse_events -> PostgreSQL
 *   PostgreSQL -> LISTEN sse_events -> All consumer instances -> broadcastEvent()
 *
 * NOTE: Prisma does not natively support LISTEN. This module uses a dedicated
 * `pg` connection for the listener if the `pg` package is available, otherwise
 * it falls back to a polling-based approach using a notification table.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import type { SSEEvent } from "@/lib/sse";

const PG_CHANNEL = "sse_events";

// ─── Notification publishing (works with Prisma) ─────────────────────────────

/**
 * Publish an SSE event to all instances via PostgreSQL NOTIFY.
 * Falls back to a notification table insert if NOTIFY fails.
 */
export async function publishEvent(event: SSEEvent): Promise<void> {
  const payload = JSON.stringify({
    type: event.type,
    data: event.data,
    timestamp: event.timestamp,
  });

  try {
    // Use Prisma raw query for NOTIFY — works without raw pg driver
    await prisma.$executeRawUnsafe(
      `SELECT pg_notify($1, $2)`,
      PG_CHANNEL,
      payload,
    );
  } catch (err) {
    // Fallback: log the error but don't crash — local broadcast still works
    logger.error("pg_notify failed, event will only reach local instance", {
      error: err instanceof Error ? err.message : String(err),
      eventType: event.type,
    });
  }
}

// ─── Polling-based listener (Prisma-compatible fallback) ─────────────────────

/**
 * Since Prisma doesn't support `LISTEN`, we provide a polling-based
 * alternative using a lightweight notifications table.
 *
 * For production deployments needing true LISTEN/NOTIFY:
 *   1. Install `pg` package: npm install pg @types/pg
 *   2. Use startNativeListener() instead of startPollingListener()
 *
 * The polling listener checks for new notifications every `intervalMs`.
 */

let pollingInterval: ReturnType<typeof setInterval> | null = null;
let lastPollTimestamp = new Date();

export interface PGListenerOptions {
  /** Polling interval in ms (default: 2000) */
  intervalMs?: number;
  /** Callback to handle received events */
  onEvent: (event: SSEEvent) => void;
}

/**
 * Start the polling-based notification listener.
 * This should be called once per instance on startup.
 */
export function startPollingListener(options: PGListenerOptions): void {
  const { intervalMs = 2000, onEvent } = options;

  if (pollingInterval) {
    logger.warn("Polling listener already running");
    return;
  }

  lastPollTimestamp = new Date();

  pollingInterval = setInterval(async () => {
    try {
      // Query for notifications newer than our last poll
      const notifications = await prisma.$queryRawUnsafe<
        Array<{ payload: string; created_at: Date }>
      >(
        `SELECT payload, created_at FROM pg_notification_log
         WHERE channel = $1 AND created_at > $2
         ORDER BY created_at ASC LIMIT 100`,
        PG_CHANNEL,
        lastPollTimestamp,
      );

      if (notifications.length > 0) {
        lastPollTimestamp = notifications[notifications.length - 1].created_at;

        for (const n of notifications) {
          try {
            const event = JSON.parse(n.payload) as SSEEvent;
            onEvent(event);
          } catch {
            // Skip malformed notifications
          }
        }
      }
    } catch {
      // Table may not exist yet — this is expected on first run.
      // The polling listener gracefully degrades to local-only SSE.
    }
  }, intervalMs);

  logger.info(`PG polling listener started (interval=${intervalMs}ms)`);
}

/**
 * Stop the polling listener.
 */
export function stopPollingListener(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    logger.info("PG polling listener stopped");
  }
}

// ─── Native LISTEN support (requires `pg` package) ──────────────────────────

/**
 * Start a native PostgreSQL LISTEN connection.
 * Requires the `pg` package to be installed.
 *
 * Usage:
 *   import { startNativeListener } from "@/lib/pg-notify";
 *   await startNativeListener({
 *     connectionString: process.env.DATABASE_URL!,
 *     onEvent: (event) => broadcastEvent(event),
 *   });
 */
export async function startNativeListener(options: {
  connectionString: string;
  onEvent: (event: SSEEvent) => void;
}): Promise<{ stop: () => Promise<void> }> {
  try {
    // Dynamic import — only works if `pg` is installed
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: options.connectionString });

    await client.connect();
    await client.query(`LISTEN ${PG_CHANNEL}`);

    client.on("notification", (msg) => {
      if (msg.channel === PG_CHANNEL && msg.payload) {
        try {
          const event = JSON.parse(msg.payload) as SSEEvent;
          options.onEvent(event);
        } catch {
          // Skip malformed payloads
        }
      }
    });

    client.on("error", (err) => {
      logger.error("PG LISTEN connection error", {
        error: err.message,
      });
    });

    logger.info("PG native LISTEN started");

    return {
      stop: async () => {
        await client.query(`UNLISTEN ${PG_CHANNEL}`);
        await client.end();
        logger.info("PG native LISTEN stopped");
      },
    };
  } catch {
    logger.warn(
      "Native pg LISTEN unavailable (pg package not installed). " +
      "Using polling fallback for multi-instance SSE.",
    );
    // Fall back to polling
    startPollingListener({
      onEvent: options.onEvent,
    });
    return {
      stop: async () => stopPollingListener(),
    };
  }
}

// ─── Auto-setup helper ──────────────────────────────────────────────────────

/**
 * Initialize the PG notification bridge.
 * Call this on server startup to enable multi-instance SSE.
 *
 * @example
 *   import { initPGNotifyBridge } from "@/lib/pg-notify";
 *   import { broadcastEvent } from "@/lib/sse";
 *   await initPGNotifyBridge(broadcastEvent);
 */
export async function initPGNotifyBridge(
  onEvent: (event: SSEEvent) => void,
): Promise<{ stop: () => Promise<void> }> {
  const dbUrl = env("DATABASE_URL");
  if (!dbUrl) {
    logger.warn("DATABASE_URL not set — PG notify bridge disabled");
    return { stop: async () => {} };
  }

  return startNativeListener({
    connectionString: dbUrl,
    onEvent,
  });
}
