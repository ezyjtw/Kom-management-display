# Schema drift baseline

**Status:** open. The reconciliation needs a reviewed data migration, so it has not been done yet.
**Enforced by:** `scripts/check-migration-drift.ts`, which runs in CI in the `schema-check` job and blocks the build.
**Baseline:** `prisma/drift-baseline.sql`.

`schema.prisma` and the migrations disagree in ways that predate Phase 12. Until Phase 12c, CI only printed a warning about this.

The check now works like this:

- New drift fails the build.
- The known drift is recorded in the baseline.
- When a baseline entry is resolved, the build also fails until that entry is removed, so the baseline only ever shrinks.

Do not regenerate the baseline to make a failure go away. A new difference needs a migration.

## What the baseline contains, and the plan for each

| Area | Drift | Risk | Plan |
|---|---|---|---|
| JSON columns stored as TEXT | `AuditLog.details`, `CategoryScore.evidence` and `.metadata`, `CommsMessage.attachments`, `CommsThread.participants`, `.linkedRecords` and `.secondaryOwnerIds`, `Incident.linkedThreadIds`, `.linkedTransactionIds` and `.rcaFollowUpItems`, `Project.tags`, `StakingWallet.tags`, `UsdcRampRequest.evidence`. The schema declares `Json`; the database holds `TEXT`. | Prisma's own diff would **drop and recreate** these columns, which loses data. `AuditLog` is also append-only, and its triggers read `details` as text (`kom_audit_details`, migration 0037). | A hand-written migration using `ALTER COLUMN ... TYPE jsonb USING <col>::jsonb`, after a pre-check that every existing value parses as JSON. For `AuditLog`: run it as the migration owner, disable the append-only triggers only inside that migration's transaction, rewrite `kom_audit_details` to take `jsonb`, and record the change in the audit log. Needs review with Platform Security (CONFIRM-DB-ROLES). |
| Missing indexes | `Alert` (status, type, threadId, employeeId, travelRuleCaseId), `AuditLog` (`(action, createdAt)`, `(userId, createdAt)`, `(entityType, entityId)`), `CommsThread`, `TravelRuleCase`, `Employee (team, active)` and others | Performance only. The `AuditLog (action, createdAt)` index matters for the ALR-SEC and ALR-AUD evaluators. | Add in the reconciliation migration with `CREATE INDEX CONCURRENTLY`. |
| `User.employeeId` | The schema has a unique constraint and a foreign key; the database has neither. | **Integrity.** Two logins could map to the same employee, and the audit actor could become ambiguous. | Check for duplicates first, then add the unique index and the FK. This is the highest-priority item. |
| Foreign keys dropped and re-added | `Alert`, `CaseNote`, `CommsMessage`, `EmployeeNote`, `IncidentUpdate`, `OwnershipChange`, `ThreadNote` | The `ON DELETE` rules differ between the schema and the database. | Decide which behaviour is intended for each table, then align. |
| `Incident` defaults | `affectedServices` and `detectionSource` are `NOT NULL` with defaults in the schema only. | Low | Backfill the nulls, then set the defaults. |
| `_archived_approval_audit_entry` | Exists in the database, absent from the schema. | This is the archived evidence from the removed approvals module (H1). Prisma's diff would **drop** it. | Keep it. Either declare it in the schema as a read-only model or exclude it from the diff. Never drop it. |

## How to reconcile

1. Write the migration by hand. Do not apply the output of `prisma migrate diff --script` directly.
2. Run it against a restored copy of production data.
3. Rerun the check. Resolved entries will fail the check.
4. Remove those entries from `prisma/drift-baseline.sql` and update this page.

Deliberately accepting the current state (`npm run drift:check -- --write-baseline`) is a reviewed change and must be explained in the PR.
