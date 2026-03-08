# ADR-005: Integration Architecture

**Status:** Accepted
**Date:** 2026-03-08
**Decision Makers:** Platform Team

## Context

The platform ingests data from multiple external systems: Jira, Confluence,
Slack, email (IMAP), Fireblocks, Komainu, and Notabene. Each has different
APIs, authentication models, rate limits, and failure modes. The architecture
must handle these differences uniformly while being resilient to outages.

## Decision

### Adapter Pattern

Each integration implements the `IntegrationAdapter` interface:

```typescript
interface IntegrationAdapter {
  source: SourceSystem;
  isConfigured(): boolean;
  sync(opts?): Promise<NormalizedEvent[]>;
  getLastSyncTime(): Date | null;
  getHealth(): IntegrationHealth;
}
```

Adapters are registered in a central `IntegrationRegistry` singleton.
Each adapter is responsible for:
- Configuration validation
- Authentication with the external system
- Data fetching with pagination
- Error handling and retry logic
- Mapping to the normalized event model

### Normalized Event Model

All inbound data is converted to `NormalizedEvent` before touching
business logic:

- `sourceSystem` — which integration produced it
- `sourceId` — dedup key from the external system
- `entityType` — thread, message, transaction, alert, etc.
- `eventType` — created, updated, resolved, etc.
- `occurredAt` — when it happened (source time)
- `receivedAt` — when we ingested it
- `payload` — normalized subject, body, actor, participants
- `rawPayload` — original payload for audit/debug
- `normalizedRefs` — links to internal entities

### Circuit Breaker

External calls are wrapped in circuit breakers (`CircuitBreaker.for(source)`):

- **Closed:** Requests pass through normally
- **Open:** Requests fail fast (no external call) after threshold failures
- **Half-open:** Single probe request to test recovery

Configuration per breaker: failure threshold, window, cooldown, call timeout.

### Health and Staleness Detection

- `getHealth()` returns per-adapter status (healthy/degraded/down/unconfigured)
- `getStaleIntegrations(thresholdMs)` detects adapters that haven't synced
  within the expected window (default: 30 minutes)
- `getHealthSummary()` groups all integrations by status
- `/api/health/dependencies` exposes this to monitoring and admin dashboards

### Webhook Deduplication

Inbound webhooks are deduplicated via the `WebhookEvent` table:
- `source` + `eventId` composite uniqueness
- Status tracking: received → processing → processed | failed | rejected_duplicate
- HMAC signature verification for webhook authenticity

## Alternatives Considered

1. **Direct API calls in business logic:** Would tightly couple domain logic
   to external APIs. The adapter pattern allows swapping implementations and
   testing with stubs.
2. **Message queue per integration:** Would add infrastructure complexity.
   The DB-backed job queue provides sufficient reliability for the current
   sync cadence.
3. **Single monolithic sync job:** Would be fragile — one integration failure
   blocks all others. The registry's `syncAll()` uses `Promise.allSettled`
   so failures are isolated.

## Consequences

- Adding a new integration requires implementing one adapter and registering it.
- Circuit breakers prevent cascading failures but mean data can be stale
  during outages — the UI shows freshness indicators.
- Raw payloads are retained for debugging but increase storage over time —
  governed by data retention policies.

## Related

- `src/modules/integrations/types/index.ts` — Adapter and event interfaces
- `src/modules/integrations/registry.ts` — Central registry
- `src/modules/integrations/adapters/` — Individual adapter implementations
- `src/lib/circuit-breaker.ts` — Circuit breaker implementation
- `src/lib/webhook-verify.ts` — HMAC signature verification
- ADR-006 — Data retention policies
