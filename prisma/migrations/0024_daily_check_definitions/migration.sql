-- Spec §7.6: definition-driven daily checks, one item per (definition, period).
-- The old one-run-per-day unique constraint is dropped.

-- DropIndex
DROP INDEX IF EXISTS "DailyCheckRun_date_key";

-- AlterTable
ALTER TABLE "DailyCheckItem" ADD COLUMN IF NOT EXISTS "dataAsOf" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "definitionCode" TEXT,
ADD COLUMN IF NOT EXISTS "evidence" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS "exceptionWorkItemIds" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN IF NOT EXISTS "periodKey" TEXT,
ADD COLUMN IF NOT EXISTS "recordCount" INTEGER,
ADD COLUMN IF NOT EXISTS "skipApprovedBy" TEXT,
ADD COLUMN IF NOT EXISTS "skippedReason" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "DailyCheckDefinition" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "dueByLocal" TEXT NOT NULL,
    "evidenceSpec" JSONB NOT NULL,
    "ticketProject" TEXT NOT NULL,
    "confluenceUrl" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyCheckDefinition_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DailyCheckDefinition_team_isActive_idx" ON "DailyCheckDefinition"("team", "isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DailyCheckDefinition_isActive_idx" ON "DailyCheckDefinition"("isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DailyCheckItem_status_idx" ON "DailyCheckItem"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DailyCheckItem_definitionCode_idx" ON "DailyCheckItem"("definitionCode");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DailyCheckItem_definitionCode_periodKey_key" ON "DailyCheckItem"("definitionCode", "periodKey");

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "DailyCheckItem" ADD CONSTRAINT "DailyCheckItem_definitionCode_fkey" FOREIGN KEY ("definitionCode") REFERENCES "DailyCheckDefinition"("code") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
