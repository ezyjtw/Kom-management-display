# ADR-005: Integration Ingestion Architecture

## Status
Accepted

## Context
The platform ingests data from 7+ external systems: Jira, Confluence, Slack, Email (IMAP), Fireblocks, Komainu, and Notabene. Each has different APIs, auth mechanisms, rate limits, and data shapes.

## Decision
Use a **normalized event model** with **integration adapters** and an **async job queue**.

## Architecture
1. **Adapters** (`src/modules/integrations/adapters/`): One per source system. Each implements `IntegrationAdapter` interface: `isConfigured()`, `sync()`, `getHealth()`.
2. **Normalized Events** (`src/modules/integrations/types/`): Every inbound data point maps to `NormalizedEvent { sourceSystem, sourceId, entityType, eventType, occurredAt, payload, rawPayload }`.
3. **Job Queue** (`src/modules/jobs/`): Async processing with retry, dead-letter, idempotency. Adapters don't touch the database directly — they return events, and workers persist them.
4. **Health Registry** (`src/modules/integrations/registry.ts`): Tracks per-adapter health, last sync, failure count, rate limit state.

## Consequences
- **Positive**: Each adapter is independently testable, retryable, and replaceable. Business logic never touches third-party SDKs directly.
- **Negative**: Additional complexity in the event normalization layer. Raw + normalized storage increases DB size.
- **Mitigation**: Store raw payloads only for high-value events (transactions, compliance). Retention policy for low-value events.
