-- Spec §7.4: alert engine fields and admin-tunable AlertRule.

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN IF NOT EXISTS "autoResolvedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT,
ADD COLUMN IF NOT EXISTS "escalatedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "fireCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "firstFiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS "lastFiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS "ruleCode" TEXT,
ADD COLUMN IF NOT EXISTS "workItemId" TEXT;

-- Backfill existing alerts: rule code = legacy type, one dedupe key per row.
UPDATE "Alert"
SET "ruleCode" = "type", "dedupeKey" = "id", "firstFiredAt" = "createdAt", "lastFiredAt" = "createdAt"
WHERE "ruleCode" IS NULL;
ALTER TABLE "Alert" ALTER COLUMN "ruleCode" SET NOT NULL;
ALTER TABLE "Alert" ALTER COLUMN "dedupeKey" SET NOT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Alert_incidentId_idx" ON "Alert"("incidentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Alert_workItemId_idx" ON "Alert"("workItemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Alert_ruleCode_dedupeKey_status_idx" ON "Alert"("ruleCode", "dedupeKey", "status");

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "Alert" ADD CONSTRAINT "Alert_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- At most one OPEN (active or acknowledged) alert per (ruleCode, dedupeKey).
-- Spec §7.4 writes @@unique([ruleCode, dedupeKey, status]); that would also
-- forbid a second *resolved* alert for the same key, so the intent
-- ("unique per open alert") is enforced with a partial index instead.
CREATE UNIQUE INDEX IF NOT EXISTS "Alert_open_ruleCode_dedupeKey_key" ON "Alert"("ruleCode", "dedupeKey") WHERE "status" <> 'resolved';

-- CreateTable
CREATE TABLE IF NOT EXISTS "AlertRule" (
    "code" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "severity" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "route" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AlertRule_enabled_idx" ON "AlertRule"("enabled");
