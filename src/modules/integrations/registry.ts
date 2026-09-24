/**
 * Integration registry (spec §8): every connector, in one place.
 */

import {
  atlassianAdapter,
  graphMailAdapter,
  graphTeamsAdapter,
  komainuAdapter,
  notabeneAdapter,
  slackAdapter,
} from "@/modules/integrations/adapters";
import type { ConnectorId, IntegrationAdapter, IntegrationHealth } from "@/modules/integrations/types";

const ADAPTERS: readonly IntegrationAdapter[] = [
  komainuAdapter,
  atlassianAdapter,
  slackAdapter,
  graphMailAdapter,
  graphTeamsAdapter,
  notabeneAdapter,
];

export function getAllAdapters(): readonly IntegrationAdapter[] {
  return ADAPTERS;
}

export function getAdapter(source: ConnectorId): IntegrationAdapter | undefined {
  return ADAPTERS.find((a) => a.source === source);
}

export async function getAllHealth(): Promise<IntegrationHealth[]> {
  return Promise.all(ADAPTERS.map((a) => a.getHealth()));
}

export async function getHealthSummary(): Promise<Record<IntegrationHealth["status"], ConnectorId[]>> {
  const summary: Record<IntegrationHealth["status"], ConnectorId[]> = { healthy: [], degraded: [], down: [], unconfigured: [], disabled: [] };
  for (const h of await getAllHealth()) summary[h.status].push(h.source);
  return summary;
}
