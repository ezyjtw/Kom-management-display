-- Partial unique index: only one active scoring config at a time.
-- This is the DB-level enforcement of the application-level invariant
-- documented in ADR-004. The app also checks this in PUT /api/scores/config
-- during activation, but the index provides defense in depth.
-- Prisma does not support partial unique indexes natively, hence raw SQL.
CREATE UNIQUE INDEX IF NOT EXISTS "ScoringConfig_active_unique"
  ON "ScoringConfig" ("active")
  WHERE "active" = true;

-- Composite index for access review queries (userId + action)
-- Supplements the existing individual column indexes on AuditLog.
CREATE INDEX IF NOT EXISTS "AuditLog_userId_action_idx"
  ON "AuditLog" ("userId", "action");

-- Composite index for active session lookups (userId + expiresAt)
-- Supplements the existing individual column indexes on SessionMetadata.
CREATE INDEX IF NOT EXISTS "SessionMetadata_userId_expiresAt_idx"
  ON "SessionMetadata" ("userId", "expiresAt");
