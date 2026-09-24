# Schema drift

**Status:** resolved in Phase 12f (migration `0043_reconcile_schema_drift`). `prisma/drift-baseline.sql` is empty.
**Enforced by:** `scripts/check-migration-drift.ts`, which runs in the CI `schema-check` job and blocks the build.

`schema.prisma` and the migrations had disagreed since before Phase 12: 62 statements in `prisma migrate diff`. Where the database was right, the schema now follows the database; where the database lacked something, migration 0043 adds it. Any new difference fails CI, and the fix is a migration. Do not regenerate the baseline to make a failure go away.

## How each item was resolved

| Area | Drift | Resolution | Why |
|---|---|---|---|
| JSON held in TEXT columns | `AuditLog.details`, `CategoryScore.evidence` and `.metadata`, `CommsMessage.attachments`, `CommsThread.participants`, `.linkedRecords` and `.secondaryOwnerIds`, `Incident.linkedThreadIds`, `.linkedTransactionIds` and `.rcaFollowUpItems`, `Project.tags`, `StakingWallet.tags`, `UsdcRampRequest.evidence` were declared `Json` but stored as `TEXT`. | **Schema aligned to the database:** declared `String` holding JSON text. | The code already writes these with `JSON.stringify` and reads them with a JSON parse. Converting to `jsonb` would rewrite every reader, and the `AuditLog` append-only and actor triggers read `details` as text. A plain `prisma migrate diff` would have **dropped and recreated** these columns (data loss). No data changed. |
| Foreign-key delete rules | `Alert`, `CaseNote`, `CommsMessage`, `EmployeeNote`, `IncidentUpdate`, `OwnershipChange`, `ThreadNote`: the schema said `Cascade`; the database had `RESTRICT` (or `SET NULL` for `Alert`). | **Schema aligned to the database** (`Restrict` / `SetNull`). | Messages, notes, incident updates and alerts are evidence, and deleting a parent must not silently delete them. No code deletes these parents. |
| `_archived_approval_audit_entry` | In the database, not in the schema; the diff would have **dropped** it. | Declared as the read-only model `ArchivedApprovalAuditEntry`. | Archived evidence of the removed approvals module (H1). Never dropped. |
| Extra indexes | `AuditLog (userId, action)`, `SessionMetadata (userId, expiresAt)` existed only in the database. | Declared in the schema. | Useful and harmless. |
| `User.employeeId` | Unique constraint and FK declared, missing in the database. | **Migration 0043** adds both. It **stops** if several users share an employee, with a message saying how to fix it. It clears links to deleted employees and records a `user_employee_link_cleared` audit entry. | Integrity: one employee must not be two logins; the audit actor must be unambiguous. |
| Missing indexes | `Alert`, `AuditLog (action, createdAt)`, `(userId, createdAt)`, `(entityType, entityId)`, `CommsThread`, `TravelRuleCase`, `Employee (team, active)` and others. | Migration 0043 (`CREATE INDEX IF NOT EXISTS`). | Performance, including the ALR-SEC and ALR-AUD evaluators. |
| `Incident` defaults | `affectedServices`, `detectionSource` were nullable in the database. | Migration 0043 backfills nulls, then sets `NOT NULL` and the defaults. | Matches the schema. |
| `KnowledgeScore.scoredBy` default | Missing in the database. | Migration 0043. | Matches the schema. |

## Verification (PostgreSQL 16)

- All migrations on a fresh database, then the drift check: **0 statements**.
- On a database at 0042 with a user linked to a deleted employee: the link is cleared and the audit entry is written.
- With two users sharing an employee: the deploy stops with the explanatory message. After unlinking one and marking the failed migration rolled back (`prisma migrate resolve --rolled-back 0043_reconcile_schema_drift`), the deploy succeeds, and a new duplicate is refused by the unique constraint.

## Deploying 0043

Before deploying, check for users sharing an employee:

```sql
SELECT "employeeId", array_agg(email) FROM "User"
WHERE "employeeId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
```

Resolve any rows it returns first (decide which login is correct). Otherwise the migration stops, as designed.
