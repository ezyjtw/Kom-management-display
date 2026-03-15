/**
 * Server-Sent Events (SSE) infrastructure for real-time push notifications.
 *
 * Events pushed to clients:
 * - sla_breach: SLA deadline breached
 * - incident_update: New/updated incident
 * - high_risk_transaction: Transaction requiring confirmation
 * - confirmation_expired: Confirmation deadline passed
 * - job_status: Background job status change
 * - alert: Generic alert notification
 */

import { logger } from "@/lib/logger";
import { publishEvent } from "@/lib/pg-notify";

export type SSEEventType =
  | "sla_breach"
  | "incident_update"
  | "high_risk_transaction"
  | "confirmation_expired"
  | "job_status"
  | "alert"
  | "heartbeat"
  | "travel_rule_update"
  | "screening_alert"
  | "settlement_update"
  | "token_review_update"
  | "compliance_deadline"
  | "staking_anomaly";

export interface SSEEvent {
  type: SSEEventType;
  data: Record<string, unknown>;
  timestamp: string;
}

interface ConnectedClient {
  id: string;
  userId: string;
  role: string;
  team: string | null;
  controller: ReadableStreamDefaultController;
  connectedAt: Date;
}

// In-memory store of connected SSE clients
const clients = new Map<string, ConnectedClient>();

/**
 * Register a new SSE client connection.
 */
export function registerClient(
  clientId: string,
  userId: string,
  role: string,
  team: string | null,
  controller: ReadableStreamDefaultController,
): void {
  clients.set(clientId, {
    id: clientId,
    userId,
    role,
    team,
    controller,
    connectedAt: new Date(),
  });
  logger.info("SSE client connected", { clientId, userId, totalClients: clients.size });
}

/**
 * Remove a disconnected client.
 */
export function removeClient(clientId: string): void {
  clients.delete(clientId);
  logger.info("SSE client disconnected", { clientId, totalClients: clients.size });
}

/**
 * Broadcast an event to all connected clients on this instance.
 * Also publishes to PG NOTIFY for multi-instance fan-out.
 *
 * @param skipPGNotify - Set true when event was received FROM PG NOTIFY
 *   (to avoid infinite re-publish loops).
 */
export function broadcastEvent(event: SSEEvent, skipPGNotify = false): void {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
  const encoder = new TextEncoder();
  const encoded = encoder.encode(payload);

  for (const [clientId, client] of clients) {
    try {
      client.controller.enqueue(encoded);
    } catch {
      // Client disconnected — clean up
      clients.delete(clientId);
    }
  }

  // Fan out to other instances via PG NOTIFY (fire-and-forget)
  if (!skipPGNotify) {
    publishEvent(event).catch(() => {
      // Silently degrade — local clients still got the event
    });
  }
}

/**
 * Send an event to a specific user.
 */
export function sendToUser(userId: string, event: SSEEvent): void {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
  const encoder = new TextEncoder();
  const encoded = encoder.encode(payload);

  for (const [clientId, client] of clients) {
    if (client.userId === userId) {
      try {
        client.controller.enqueue(encoded);
      } catch {
        clients.delete(clientId);
      }
    }
  }
}

/**
 * Send an event to users with specific roles.
 */
export function sendToRoles(roles: string[], event: SSEEvent): void {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
  const encoder = new TextEncoder();
  const encoded = encoder.encode(payload);

  for (const [clientId, client] of clients) {
    if (roles.includes(client.role)) {
      try {
        client.controller.enqueue(encoded);
      } catch {
        clients.delete(clientId);
      }
    }
  }
}

/**
 * Send an event to users on a specific team.
 */
export function sendToTeam(team: string, event: SSEEvent): void {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
  const encoder = new TextEncoder();
  const encoded = encoder.encode(payload);

  for (const [clientId, client] of clients) {
    if (client.team === team) {
      try {
        client.controller.enqueue(encoded);
      } catch {
        clients.delete(clientId);
      }
    }
  }
}

/**
 * Get the number of connected clients.
 */
export function getConnectedClientCount(): number {
  return clients.size;
}

/**
 * Get connected client info (for admin dashboard).
 */
export function getConnectedClients(): Array<{
  id: string;
  userId: string;
  role: string;
  team: string | null;
  connectedAt: Date;
}> {
  return Array.from(clients.values()).map(({ controller, ...rest }) => rest);
}

// ─── Convenience event emitters ───

export function emitSLABreach(data: {
  threadId: string;
  subject: string;
  slaType: string;
  breachedAt: string;
}): void {
  broadcastEvent({
    type: "sla_breach",
    data,
    timestamp: new Date().toISOString(),
  });
}

export function emitIncidentUpdate(data: {
  incidentId: string;
  title: string;
  severity: string;
  status: string;
  provider: string;
}): void {
  broadcastEvent({
    type: "incident_update",
    data,
    timestamp: new Date().toISOString(),
  });
}

export function emitHighRiskTransaction(data: {
  confirmationId: string;
  transactionId: string;
  asset: string;
  amount: number;
  riskLevel: string;
}): void {
  sendToRoles(["admin", "lead"], {
    type: "high_risk_transaction",
    data,
    timestamp: new Date().toISOString(),
  });
}

export function emitAlert(data: {
  alertId: string;
  type: string;
  severity: string;
  message: string;
}): void {
  broadcastEvent({
    type: "alert",
    data,
    timestamp: new Date().toISOString(),
  });
}

export function emitTravelRuleUpdate(data: {
  caseId: string;
  transactionId: string;
  matchStatus: string;
  action: string;
}): void {
  sendToRoles(["admin", "lead"], {
    type: "travel_rule_update",
    data,
    timestamp: new Date().toISOString(),
  });
}

export function emitScreeningAlert(data: {
  screeningId: string;
  transactionId: string;
  riskLevel: string;
  classification: string;
}): void {
  sendToRoles(["admin", "lead"], {
    type: "screening_alert",
    data,
    timestamp: new Date().toISOString(),
  });
}

export function emitSettlementUpdate(data: {
  settlementId: string;
  settlementRef: string;
  status: string;
  venue: string;
  asset: string;
  amount: number;
}): void {
  sendToRoles(["admin", "lead"], {
    type: "settlement_update",
    data,
    timestamp: new Date().toISOString(),
  });
}

export function emitTokenReviewUpdate(data: {
  tokenId: string;
  symbol: string;
  status: string;
  action: string;
}): void {
  broadcastEvent({
    type: "token_review_update",
    data,
    timestamp: new Date().toISOString(),
  });
}

export function emitComplianceDeadline(data: {
  entityType: string;
  entityId: string;
  deadline: string;
  description: string;
  hoursRemaining: number;
}): void {
  sendToRoles(["admin", "lead"], {
    type: "compliance_deadline",
    data,
    timestamp: new Date().toISOString(),
  });
}

export function emitStakingAnomaly(data: {
  walletId: string;
  asset: string;
  network: string;
  anomalyType: string;
  description: string;
}): void {
  sendToRoles(["admin", "lead"], {
    type: "staking_anomaly",
    data,
    timestamp: new Date().toISOString(),
  });
}
