/**
 * Job queue types for async processing.
 *
 * Handles message ingestion, webhook processing, reconciliation,
 * outbound notifications, and periodic SLA scans.
 */

export type JobStatus = "pending" | "processing" | "completed" | "failed" | "dead_letter";

export type JobType =
  | "email_sync"
  | "slack_sync"
  | "jira_sync"
  | "webhook_process"
  | "sla_scan"
  | "alert_generate"
  | "notification_send"
  | "travel_rule_reconcile"
  | "staking_reconcile"
  | "daily_check_auto"
  | "score_compute"
  | "export_generate";

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  attempts: number;
  maxAttempts: number;
  retryPolicy: RetryPolicy;
  lastError?: string;
  scheduledAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
}

export const DEFAULT_RETRY_POLICIES: Record<string, RetryPolicy> = {
  email_sync:             { maxAttempts: 3, backoffMs: 5000,  backoffMultiplier: 2, maxBackoffMs: 60000  },
  slack_sync:             { maxAttempts: 3, backoffMs: 2000,  backoffMultiplier: 2, maxBackoffMs: 30000  },
  jira_sync:              { maxAttempts: 3, backoffMs: 5000,  backoffMultiplier: 2, maxBackoffMs: 60000  },
  webhook_process:        { maxAttempts: 5, backoffMs: 1000,  backoffMultiplier: 2, maxBackoffMs: 30000  },
  sla_scan:               { maxAttempts: 2, backoffMs: 10000, backoffMultiplier: 1, maxBackoffMs: 10000  },
  alert_generate:         { maxAttempts: 2, backoffMs: 5000,  backoffMultiplier: 1, maxBackoffMs: 5000   },
  notification_send:      { maxAttempts: 3, backoffMs: 2000,  backoffMultiplier: 2, maxBackoffMs: 30000  },
  travel_rule_reconcile:  { maxAttempts: 3, backoffMs: 10000, backoffMultiplier: 2, maxBackoffMs: 120000 },
  staking_reconcile:      { maxAttempts: 3, backoffMs: 10000, backoffMultiplier: 2, maxBackoffMs: 120000 },
  daily_check_auto:       { maxAttempts: 2, backoffMs: 5000,  backoffMultiplier: 1, maxBackoffMs: 5000   },
  score_compute:          { maxAttempts: 2, backoffMs: 5000,  backoffMultiplier: 1, maxBackoffMs: 5000   },
  export_generate:        { maxAttempts: 2, backoffMs: 5000,  backoffMultiplier: 1, maxBackoffMs: 5000   },
};

export interface JobHandler {
  type: JobType;
  handle(payload: Record<string, unknown>): Promise<void>;
}
