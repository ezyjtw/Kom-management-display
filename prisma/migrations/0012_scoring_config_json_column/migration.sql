-- AlterTable: Convert ScoringConfig.config from TEXT to JSONB
-- This is a non-destructive migration: existing JSON strings are cast to JSONB.

ALTER TABLE "ScoringConfig" ALTER COLUMN "config" TYPE JSONB USING "config"::jsonb;

-- Add indexes for scoring config lookups
CREATE INDEX IF NOT EXISTS "ScoringConfig_status_idx" ON "ScoringConfig"("status");
CREATE INDEX IF NOT EXISTS "ScoringConfig_active_idx" ON "ScoringConfig"("active");
