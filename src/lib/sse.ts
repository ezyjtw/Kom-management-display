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

export type SSEEventType =
  | "sla_breach"
  | "incident_update"
  | "high_risk_transaction"
  | "confirmation_expired"
  | "job_status"
  | "alert"
  | "heartbeat";

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
 * Broadcast an event to all connected clients.
 */
export function broadcastEvent(event: SSEEvent): void {
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
