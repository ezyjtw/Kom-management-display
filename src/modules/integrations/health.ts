import { prisma } from "@/lib/prisma";
import type { HeartbeatHealth, HeartbeatSpec, IntegrationAdapter, IntegrationHealth } from "@/modules/integrations/types";

/** Stale = no success within 2 × expected cadence (spec §11.2 ALR-HB-*). */
export function isStale(lastSuccessAt: Date | null, expectedEveryMins: number, now = new Date()): boolean {
  if (!lastSuccessAt) return true;
  return now.getTime() - lastSuccessAt.getTime() > 2 * expectedEveryMins * 60_000;
}

export async function computeHealth(
  adapter: Pick<IntegrationAdapter, "source" | "label" | "isConfigured" | "isEnabled" | "heartbeats">,
  extra: { rateLimitRemaining?: number } = {},
  now = new Date(),
): Promise<IntegrationHealth> {
  const base = { source: adapter.source, label: adapter.label, heartbeats: [] as HeartbeatHealth[], lastSuccessfulSync: null, ...extra };
  const enabled = await adapter.isEnabled();
  if (!enabled) return { ...base, configured: adapter.isConfigured(), enabled, status: "disabled", detail: "Switched off by feature flag" };
  if (!adapter.isConfigured()) return { ...base, configured: false, enabled, status: "unconfigured", detail: "Credentials not set" };

  const specs: HeartbeatSpec[] = adapter.heartbeats();
  const rows = specs.length
    ? await prisma.sourceHeartbeat.findMany({ where: { source: { in: specs.map((s) => s.source) } } })
    : [];
  const bySource = new Map(rows.map((r) => [r.source, r]));
  const heartbeats: HeartbeatHealth[] = specs.map((s) => {
    const row = bySource.get(s.source);
    return {
      source: s.source,
      expectedEveryMins: s.expectedEveryMins,
      lastSuccessAt: row?.lastSuccessAt?.toISOString() ?? null,
      lastRecordAt: row?.lastRecordAt?.toISOString() ?? null,
      stale: isStale(row?.lastSuccessAt ?? null, s.expectedEveryMins, now),
    };
  });
  const fresh = heartbeats.filter((h) => !h.stale).length;
  const status = heartbeats.length === 0 ? "degraded" : fresh === heartbeats.length ? "healthy" : fresh === 0 ? "down" : "degraded";
  const lastSuccessfulSync = heartbeats.map((h) => h.lastSuccessAt).filter((v): v is string => !!v).sort().at(-1) ?? null;
  return {
    ...base,
    configured: true,
    enabled,
    status,
    heartbeats,
    lastSuccessfulSync,
    ...(status === "down" ? { detail: "No successful sync within twice the expected interval" } : {}),
  };
}
