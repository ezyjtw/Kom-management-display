-- AlterTable: Convert ScoringConfig.config from TEXT to JSONB
-- This is a non-destructive migration: existing JSON strings are cast to JSONB.

ALTER TABLE "ScoringConfig" ALTER COLUMN "config" TYPE JSONB USING "config"::jsonb;

-- Create ScoringConfigStatus enum
DO $$ BEGIN
  CREATE TYPE "ScoringConfigStatus" AS ENUM ('draft', 'review', 'approved', 'active', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add missing columns to ScoringConfig
ALTER TABLE "ScoringConfig" ADD COLUMN IF NOT EXISTS "status" "ScoringConfigStatus" NOT NULL DEFAULT 'draft';
ALTER TABLE "ScoringConfig" ADD COLUMN IF NOT EXISTS "reviewedById" TEXT;
ALTER TABLE "ScoringConfig" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
ALTER TABLE "ScoringConfig" ADD COLUMN IF NOT EXISTS "approvedById" TEXT;
ALTER TABLE "ScoringConfig" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "ScoringConfig" ADD COLUMN IF NOT EXISTS "activatedAt" TIMESTAMP(3);

-- Rename createdBy to createdById if needed
DO $$ BEGIN
  ALTER TABLE "ScoringConfig" RENAME COLUMN "createdBy" TO "createdById";
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

-- Add foreign keys for ScoringConfig user relations
DO $$ BEGIN
  ALTER TABLE "ScoringConfig" ADD CONSTRAINT "ScoringConfig_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ScoringConfig" ADD CONSTRAINT "ScoringConfig_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ScoringConfig" ADD CONSTRAINT "ScoringConfig_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add indexes for scoring config lookups
CREATE INDEX IF NOT EXISTS "ScoringConfig_status_idx" ON "ScoringConfig"("status");
CREATE INDEX IF NOT EXISTS "ScoringConfig_active_idx" ON "ScoringConfig"("active");
