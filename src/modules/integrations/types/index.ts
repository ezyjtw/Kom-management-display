/**
 * Integration adapter contract (spec §8). Each connector reports health from
 * SourceHeartbeat (shared by the web and worker processes), goes through
 * CircuitBreaker.for(<breakerName>) and makes all HTTP calls through
 * src/lib/http/client.ts.
 */

export type ConnectorId = "custody_api" | "atlassian" | "slack" | "graph_mail" | "graph_teams" | "notabene";

export interface HeartbeatSpec {
  source: string;
  expectedEveryMins: number;
}

export interface IntegrationAdapter {
  source: ConnectorId;
  label: string;
  breakerName: string;
  isConfigured(): boolean;
  /** Feature-flag gate; false means the connector is deliberately off. */
  isEnabled(): Promise<boolean>;
  heartbeats(): HeartbeatSpec[];
  getHealth(): Promise<IntegrationHealth>;
}

export interface HeartbeatHealth {
  source: string;
  expectedEveryMins: number;
  lastSuccessAt: string | null;
  lastRecordAt: string | null;
  stale: boolean;
}

export interface IntegrationHealth {
  source: ConnectorId;
  label: string;
  configured: boolean;
  enabled: boolean;
  status: "healthy" | "degraded" | "down" | "unconfigured" | "disabled";
  lastSuccessfulSync: string | null;
  rateLimitRemaining?: number;
  heartbeats: HeartbeatHealth[];
  detail?: string;
}
