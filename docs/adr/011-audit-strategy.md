# ADR-006: Auditability Strategy

## Status
Accepted

## Context
As a digital asset custody operations platform, auditability is critical for:
- Compliance requirements
- Incident investigation
- Change tracking
- Export governance

## Decision
Implement **structured audit logging** with **event tables** for high-value workflow transitions.

## Approach
1. **AuditLog table**: Generic audit for all mutations (who/what/when/before/after/why)
2. **WorkflowEvent table**: Immutable event ledger for state transitions (thread assignments, case transitions, score changes, config activations)
3. **Structured audit service** (`src/lib/api/audit.ts`): Every sensitive mutation calls `createAuditEntry()` with before/after snapshots
4. **Export audit**: Every data export is logged with user, scope, format, row count

## Audit Actions
- Authentication: login_success, login_failed
- Scores: score_updated, score_override
- Config: config_change, config_activated
- Threads: thread_assigned, thread_reassigned, ownership_change, status_change
- Alerts: alert_acknowledged, alert_resolved
- Travel Rule: travel_rule_transition
- Incidents: incident_update, incident_resolved
- Exports: export_generated
- Users: user_created, user_updated

## Consequences
- **Positive**: Complete audit trail, human-readable summaries + machine-parseable structured data
- **Negative**: Storage growth, slight write latency
- **Mitigation**: Audit writes are fire-and-forget (never break primary operations). Retention policy for old audit logs.
