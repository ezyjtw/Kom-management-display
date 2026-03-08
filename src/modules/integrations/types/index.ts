/**
 * Normalized event model for all inbound integrations.
 *
 * Every integration (Jira, Slack, email, Fireblocks, Komainu, Notabene)
 * maps its data into this format before it touches any business logic.
 */

export type SourceSystem =
  | "jira"
  | "confluence"
  | "slack"
  | "email"
  | "fireblocks"
  | "komainu"
  | "notabene"
  | "manual"
  | "system";

export type EntityType =
  | "thread"
  | "message"
  | "ticket"
  | "transaction"
  | "transfer"
  | "alert"
  | "document"
  | "comment"
  | "approval";

export type EventType =
  | "created"
  | "updated"
  | "status_changed"
  | "assigned"
  | "commented"
  | "resolved"
  | "closed"
  | "reopened"
  | "escalated"
  | "attachment_added"
  | "approval_requested"
  | "approval_granted"
  | "approval_rejected";

export interface NormalizedEvent {
  /** Unique event ID */
  id: string;
  /** Source system that generated this event */
  sourceSystem: SourceSystem;
  /** Source-system-specific ID for deduplication */
  sourceId: string;
  /** Type of entity this event relates to */
  entityType: EntityType;
  /** What happened */
  eventType: EventType;
  /** When the event actually occurred (source system time) */
  occurredAt: Date;
  /** When we received/processed it */
  receivedAt: Date;
  /** Normalized payload */
  payload: NormalizedPayload;
  /** Raw payload from the source for audit/debug */
  rawPayload?: Record<string, unknown>;
  /** References to internal entities */
  normalizedRefs?: NormalizedRef[];
}

export interface NormalizedPayload {
  /** Subject/title */
  subject?: string;
  /** Body/description */
  body?: string;
  /** Status in normalized form */
  status?: string;
  /** Priority */
  priority?: string;
  /** Actor who performed the action */
  actor?: {
    name: string;
    email?: string;
    sourceId?: string;
  };
  /** Participants */
  participants?: Array<{
    name: string;
    email?: string;
    role?: string;
  }>;
  /** Key-value metadata */
  metadata?: Record<string, unknown>;
}

export interface NormalizedRef {
  /** Internal entity type */
  entityType: string;
  /** Internal entity ID */
  entityId: string;
  /** Relationship type */
  relationship: "primary" | "related" | "parent" | "child";
}

/**
 * Integration adapter interface.
 * Each connector must implement this to normalize its data.
 */
export interface IntegrationAdapter {
  /** Source system identifier */
  source: SourceSystem;

  /** Whether this adapter is configured and ready */
  isConfigured(): boolean;

  /** Sync data and return normalized events */
  sync(opts?: Record<string, unknown>): Promise<NormalizedEvent[]>;

  /** Get last successful sync time */
  getLastSyncTime(): Date | null;

  /** Get connector health status */
  getHealth(): IntegrationHealth;
}

export interface IntegrationHealth {
  source: SourceSystem;
  configured: boolean;
  lastSuccessfulSync: Date | null;
  lastFailure: Date | null;
  lastFailureMessage?: string;
  queueBacklog: number;
  rateLimitRemaining?: number;
  failureCount: number;
  status: "healthy" | "degraded" | "down" | "unconfigured";
}
