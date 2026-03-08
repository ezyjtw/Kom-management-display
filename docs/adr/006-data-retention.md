# ADR-006: Data Retention and Archival

**Status:** Accepted
**Date:** 2026-03-08
**Decision Makers:** Platform Team

## Context

The platform stores operational data including audit logs, communication
threads, background job history, session metadata, alerts, and scoring
configs. Without retention policies, storage grows unbounded and
compliance obligations around data minimization are not met.

## Decision

### Retention Periods

| Data Type | Retention | Rationale |
|-----------|-----------|-----------|
| Audit logs | 2 years | Regulatory compliance, incident investigation |
| Comms messages | 1 year | Operational reference, then archive |
| Resolved incidents | 2 years | Post-mortem and pattern analysis |
| Background job history | 30 days | Diagnostic value only |
| Session metadata | 30 days | Security review window |
| Resolved alerts | 90 days | Trend analysis |
| Archived scoring configs | 2 years | Historical comparison |

### Implementation

`enforceRetentionPolicies()` in `src/lib/data-retention.ts`:
- Runs as a scheduled background job
- Processes each policy sequentially to avoid lock contention
- Deletes in batches via Prisma `deleteMany`
- Logs every deletion run to the audit log
- Returns a summary report of deletions per policy

### Database Model

`DataRetentionPolicy` table stores configurable policies:
- `entityType` — which data type (unique constraint)
- `retentionDays` — how long to keep
- `archiveEnabled` — whether to archive before purge
- `purgeEnabled` — whether automatic purge is active

### Safeguards

- Retention enforcement is audit-logged itself
- Default policies are defined in code but can be overridden
  via the `DataRetentionPolicy` table
- Archive-before-purge is supported for entities that need it
- Immutable records (WorkflowEvent) are exempt from purge

## Alternatives Considered

1. **No automated retention:** Simpler but leads to unbounded growth
   and compliance risk. Manual cleanup is error-prone.
2. **Soft-delete everything:** Keeps data accessible but doesn't reduce
   storage. Soft-delete is used for some entities but hard deletion
   is necessary for data minimization compliance.
3. **External archival service:** Would reduce DB size but adds
   infrastructure complexity. In-DB archival is sufficient for the
   current data volumes.

## Consequences

- Data older than retention periods is permanently deleted.
- Audit logs of deletions provide proof that retention was enforced.
- Operators should be made aware that old communications and alerts
  will not be available after the retention window.

## Related

- `src/lib/data-retention.ts` — Retention enforcement implementation
- `prisma/schema.prisma` — `DataRetentionPolicy` model
- ADR-005 — Integration architecture (raw payload retention)
