-- CreateTable: SessionMetadata (missing from prior migrations)
CREATE TABLE IF NOT EXISTS "SessionMetadata" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionMetadata_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SessionMetadata_sessionToken_key" ON "SessionMetadata"("sessionToken");
CREATE INDEX IF NOT EXISTS "SessionMetadata_userId_idx" ON "SessionMetadata"("userId");
CREATE INDEX IF NOT EXISTS "SessionMetadata_expiresAt_idx" ON "SessionMetadata"("expiresAt");

-- Partial unique index: only one active scoring config at a time.
CREATE UNIQUE INDEX IF NOT EXISTS "ScoringConfig_active_unique"
  ON "ScoringConfig" ("active")
  WHERE "active" = true;

-- Composite index for access review queries (userId + action)
CREATE INDEX IF NOT EXISTS "AuditLog_userId_action_idx"
  ON "AuditLog" ("userId", "action");

-- Composite index for active session lookups (userId + expiresAt)
CREATE INDEX IF NOT EXISTS "SessionMetadata_userId_expiresAt_idx"
  ON "SessionMetadata" ("userId", "expiresAt");
