/**
 * Integration registry.
 *
 * Central registry that holds all integration adapters and provides
 * convenience methods for sync, health checks, and adapter lookup.
 */

import { logger } from "@/lib/logger";
import type {
  IntegrationAdapter,
  IntegrationHealth,
  NormalizedEvent,
  SourceSystem,
} from "@/modules/integrations/types";

import { JiraAdapter } from "@/modules/integrations/adapters/jira-adapter";
import { SlackAdapter } from "@/modules/integrations/adapters/slack-adapter";
import { EmailAdapter } from "@/modules/integrations/adapters/email-adapter";
import { FireblocksAdapter } from "@/modules/integrations/adapters/fireblocks-adapter";
import { KomainuAdapter } from "@/modules/integrations/adapters/komainu-adapter";
import { NotabeneAdapter } from "@/modules/integrations/adapters/notabene-adapter";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

class IntegrationRegistry {
  private adapters = new Map<SourceSystem, IntegrationAdapter>();

  constructor() {
    this.register(new JiraAdapter());
    this.register(new SlackAdapter());
    this.register(new EmailAdapter());
    this.register(new FireblocksAdapter());
    this.register(new KomainuAdapter());
    this.register(new NotabeneAdapter());
  }

  /**
   * Register an adapter. Replaces any existing adapter for the same source.
   */
  register(adapter: IntegrationAdapter): void {
    this.adapters.set(adapter.source, adapter);
    logger.debug("Integration adapter registered", {
      source: adapter.source,
      configured: adapter.isConfigured(),
    });
  }

  /**
   * Get an adapter by source system.
   */
  getAdapter(source: SourceSystem): IntegrationAdapter | undefined {
    return this.adapters.get(source);
  }

  /**
   * Get all registered adapters.
   */
  getAllAdapters(): IntegrationAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Get health status for all registered integrations.
   * Useful for admin dashboards.
   */
  getAllHealth(): IntegrationHealth[] {
    return this.getAllAdapters().map((adapter) => adapter.getHealth());
  }

  /**
   * Sync all configured integrations in parallel.
   * Returns all normalized events from every adapter.
   * Individual adapter failures do not prevent other adapters from syncing.
   */
  async syncAll(
    opts?: Record<SourceSystem, Record<string, unknown>>,
  ): Promise<{ events: NormalizedEvent[]; errors: Array<{ source: SourceSystem; error: string }> }> {
    const adapters = this.getAllAdapters().filter((a) => a.isConfigured());
    const allEvents: NormalizedEvent[] = [];
    const errors: Array<{ source: SourceSystem; error: string }> = [];

    logger.info("Starting sync for all configured integrations", {
      count: adapters.length,
      sources: adapters.map((a) => a.source),
    });

    const results = await Promise.allSettled(
      adapters.map(async (adapter) => {
        const adapterOpts = opts?.[adapter.source];
        try {
          const events = await adapter.sync(adapterOpts);
          return { source: adapter.source, events };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error("Adapter sync threw unexpectedly", {
            source: adapter.source,
            error: message,
          });
          throw err;
        }
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        allEvents.push(...result.value.events);
      } else {
        // This shouldn't normally happen since adapters catch their own errors,
        // but handle it defensively.
        const message =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        errors.push({ source: "system" as SourceSystem, error: message });
      }
    }

    logger.info("Sync completed for all integrations", {
      totalEvents: allEvents.length,
      errorCount: errors.length,
    });

    return { events: allEvents, errors };
  }

  /**
   * Detect stale integrations — those whose last successful sync
   * is older than the given threshold (default: 30 minutes).
   * Useful for monitoring dashboards and alerts.
   */
  getStaleIntegrations(thresholdMs = 30 * 60 * 1000): IntegrationHealth[] {
    const now = Date.now();
    return this.getAllHealth().filter((health) => {
      if (!health.configured || health.status === "unconfigured") return false;
      if (!health.lastSuccessfulSync) return true; // never synced = stale
      return now - health.lastSuccessfulSync.getTime() > thresholdMs;
    });
  }

  /**
   * Get a summary of all integrations grouped by health status.
   */
  getHealthSummary(): Record<IntegrationHealth["status"], SourceSystem[]> {
    const summary: Record<IntegrationHealth["status"], SourceSystem[]> = {
      healthy: [],
      degraded: [],
      down: [],
      unconfigured: [],
    };
    for (const health of this.getAllHealth()) {
      summary[health.status].push(health.source);
    }
    return summary;
  }
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

export const integrationRegistry = new IntegrationRegistry();

/**
 * Convenience: get an adapter by source.
 */
export function getAdapter(source: SourceSystem): IntegrationAdapter | undefined {
  return integrationRegistry.getAdapter(source);
}

/**
 * Convenience: get health for all integrations.
 */
export function getAllHealth(): IntegrationHealth[] {
  return integrationRegistry.getAllHealth();
}

/**
 * Convenience: sync all configured integrations.
 */
export async function syncAll(
  opts?: Record<SourceSystem, Record<string, unknown>>,
) {
  return integrationRegistry.syncAll(opts);
}

/**
 * Convenience: get integrations that haven't synced within the threshold.
 */
export function getStaleIntegrations(thresholdMs?: number): IntegrationHealth[] {
  return integrationRegistry.getStaleIntegrations(thresholdMs);
}

/**
 * Convenience: get health summary grouped by status.
 */
export function getHealthSummary() {
  return integrationRegistry.getHealthSummary();
}
