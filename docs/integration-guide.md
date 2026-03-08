# Integration Guide

## Overview

The platform ingests data from multiple external systems through a normalized adapter pattern. Each integration implements the `IntegrationAdapter` interface, converting source-specific data into `NormalizedEvent` objects before any business logic is applied.

**Source code**: `src/modules/integrations/`

## Normalized Event Model

Every inbound data point is mapped to this format (defined in `src/modules/integrations/types/index.ts`):

```typescript
interface NormalizedEvent {
  id: string;              // Unique event ID
  sourceSystem: SourceSystem;  // "jira" | "slack" | "email" | "fireblocks" | "komainu" | "notabene" | "manual" | "system"
  sourceId: string;        // Source-system-specific ID (for deduplication)
  entityType: EntityType;  // "thread" | "message" | "ticket" | "transaction" | "transfer" | "alert" | "document" | "comment" | "approval"
  eventType: EventType;    // "created" | "updated" | "status_changed" | "assigned" | "commented" | "resolved" | "closed" | "reopened" | "escalated" | etc.
  occurredAt: Date;        // When the event actually happened (source system time)
  receivedAt: Date;        // When we received/processed it
  payload: NormalizedPayload;  // Normalized fields (subject, body, status, priority, actor, participants, metadata)
  rawPayload?: Record<string, unknown>;  // Original payload for audit/debug
  normalizedRefs?: NormalizedRef[];      // References to internal entities
}
```

The `NormalizedPayload` includes optional fields: `subject`, `body`, `status`, `priority`, `actor` (name, email), `participants`, and `metadata` (key-value).

## Available Adapters

### Slack (`slack-adapter.ts`)

| Property | Value |
|----------|-------|
| Source system | `slack` |
| Auth | Bot token (`SLACK_BOT_TOKEN`) |
| Sync mode | Push (webhooks) + Pull (API polling) |
| Webhook verification | HMAC-SHA256 signature using `SLACK_SIGNING_SECRET` |
| Entity types | `thread`, `message`, `comment` |
| Env vars | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` |

Maps Slack channel messages and threads into comms threads. Thread replies are linked via `thread_ts`. Supports channel discovery and participant extraction.

### Email / IMAP (`email-adapter.ts`)

| Property | Value |
|----------|-------|
| Source system | `email` |
| Auth | IMAP credentials |
| Sync mode | Pull (IMAP polling) |
| Entity types | `thread`, `message` |
| Deduplication | By `Message-ID` header |
| Env vars | `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASSWORD` |

Connects to an IMAP mailbox, fetches new messages, and groups them into threads using `In-Reply-To` and `References` headers. Extracts participants from From/To/CC fields. Attachment metadata (filename, content type, size) is captured but attachments are not stored.

### Jira (`jira-adapter.ts`)

| Property | Value |
|----------|-------|
| Source system | `jira` |
| Auth | API token (basic auth) |
| Sync mode | Pull (REST API polling) |
| Entity types | `ticket`, `comment` |
| Env vars | `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` |

Polls Jira for issue updates using JQL queries. Maps Jira issues to tickets and comments to comment events. Status transitions are captured as `status_changed` events.

### Fireblocks (`fireblocks-adapter.ts`)

| Property | Value |
|----------|-------|
| Source system | `fireblocks` |
| Auth | API key + secret |
| Sync mode | Pull (API polling) |
| Entity types | `transaction`, `transfer` |
| Env vars | `FIREBLOCKS_API_KEY`, `FIREBLOCKS_API_SECRET` |

Pulls transaction data from Fireblocks for wallet operations monitoring. Maps transactions and vault operations into normalized events.

### Komainu (`komainu-adapter.ts`)

| Property | Value |
|----------|-------|
| Source system | `komainu` |
| Auth | API key |
| Sync mode | Pull (API polling) |
| Entity types | `transaction`, `approval` |
| Env vars | `KOMAINU_API_KEY`, `KOMAINU_API_URL` |

Integrates with Komainu custody platform. Pulls custody operations and approval workflows.

### Notabene (`notabene-adapter.ts`)

| Property | Value |
|----------|-------|
| Source system | `notabene` |
| Auth | API key + VASP DID |
| Sync mode | Pull (API polling) |
| Entity types | `transfer`, `approval` |
| Env vars | `NOTABENE_API_KEY`, `NOTABENE_VASP_DID` |

Integrates with Notabene for travel rule compliance. Pulls transfer requests and approval statuses for regulatory case management.

## How to Add a New Integration

### 1. Create the adapter file

Create `src/modules/integrations/adapters/<name>-adapter.ts` implementing the `IntegrationAdapter` interface:

```typescript
import type { IntegrationAdapter, IntegrationHealth, NormalizedEvent } from "@/modules/integrations/types";

class MyAdapter implements IntegrationAdapter {
  source = "my_source" as const;

  isConfigured(): boolean {
    return !!process.env.MY_SOURCE_API_KEY;
  }

  async sync(opts?: Record<string, unknown>): Promise<NormalizedEvent[]> {
    if (!this.isConfigured()) return [];
    // 1. Fetch data from external API
    // 2. Map to NormalizedEvent[]
    // 3. Set sourceId for deduplication
    return events;
  }

  getLastSyncTime(): Date | null {
    return this.lastSync;
  }

  getHealth(): IntegrationHealth {
    return {
      source: this.source,
      configured: this.isConfigured(),
      lastSuccessfulSync: this.lastSync,
      lastFailure: this.lastFailure,
      lastFailureMessage: this.lastError,
      queueBacklog: 0,
      failureCount: this.failures,
      status: this.isConfigured() ? "healthy" : "unconfigured",
    };
  }
}
```

### 2. Register the adapter

Add the adapter to the integration registry in `src/modules/integrations/registry.ts`.

### 3. Add the API route

Create an API route for manual sync triggering at `src/app/api/integrations/<name>/route.ts`.

### 4. Add environment variables

Document required env vars in `docs/deployment.md` and `.env.example`.

### 5. Add source system type

Add the new source to the `SourceSystem` union type in `src/modules/integrations/types/index.ts`.

## Webhook Verification

For push-based integrations (currently Slack), incoming webhooks must be verified before processing.

### Slack Webhook Verification

```typescript
// Verifies HMAC-SHA256 signature
// See: https://api.slack.com/authentication/verifying-requests-from-slack
verifySlackSignature(signingSecret, signature, timestamp, body): Promise<boolean>
```

Checks:
1. Timestamp is within 5 minutes (replay attack prevention)
2. HMAC-SHA256 of `v0:{timestamp}:{body}` matches the provided signature
3. Uses timing-safe comparison to prevent timing attacks

### Adding Webhook Verification for New Adapters

1. Implement a `verify(request)` method on the adapter
2. Call verification before processing in the API route handler
3. Return 401 for failed verification (do not process the payload)
4. Log verification failures for security monitoring

## Retry and Idempotency

### Retry Strategy

The job queue handles retries for failed sync operations:

| Parameter | Value |
|-----------|-------|
| Max retries | 3 |
| Backoff | Exponential (1s, 4s, 16s) |
| Dead-letter | Failed after max retries are moved to dead-letter for manual review |

### Idempotency

Deduplication is handled via `sourceSystem + sourceId` composite key:

1. Each `NormalizedEvent` includes a `sourceId` (the external system's unique identifier)
2. Before persisting, the worker checks if `(sourceSystem, sourceId)` already exists
3. Duplicate events are silently dropped (logged at debug level)
4. This allows safe retry of sync operations without creating duplicate records

## Connector Health Monitoring

Each adapter reports its health via the `getHealth()` method, returning an `IntegrationHealth` object:

```typescript
interface IntegrationHealth {
  source: SourceSystem;
  configured: boolean;           // Are env vars present?
  lastSuccessfulSync: Date | null;
  lastFailure: Date | null;
  lastFailureMessage?: string;
  queueBacklog: number;          // Pending events in queue
  rateLimitRemaining?: number;   // API rate limit headroom
  failureCount: number;          // Consecutive failures
  status: "healthy" | "degraded" | "down" | "unconfigured";
}
```

### Status Definitions

| Status | Meaning |
|--------|---------|
| `healthy` | Configured, last sync successful, no queue backlog |
| `degraded` | Configured but experiencing intermittent failures or growing backlog |
| `down` | Configured but unable to connect or authenticate |
| `unconfigured` | Required environment variables are missing |

### Monitoring Endpoint

`GET /api/integrations/health` (admin only) returns health for all registered adapters. Use this endpoint for dashboards and alerting.
