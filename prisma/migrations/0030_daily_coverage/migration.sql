-- Spec §12: complete coverage of daily work.

ALTER TABLE "DailyCheckDefinition" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'check';
ALTER TABLE "DailyCheckDefinition" ADD COLUMN IF NOT EXISTS "requiredFlag" TEXT;
ALTER TABLE "DailyCheckDefinition" ADD COLUMN IF NOT EXISTS "restricted" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "TeamConfig" (
    "team" TEXT NOT NULL,
    "leadEmployeeId" TEXT,
    "deputyEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TeamConfig_pkey" PRIMARY KEY ("team")
);

CREATE TABLE IF NOT EXISTS "AssetStatus" (
    "asset" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'normal',
    "reason" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssetStatus_pkey" PRIMARY KEY ("asset")
);

CREATE TABLE IF NOT EXISTS "ApprovedValidator" (
    "id" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "validator" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApprovedValidator_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ApprovedValidator_chain_validator_key" ON "ApprovedValidator"("chain", "validator");

INSERT INTO "TeamConfig" ("team", "updatedAt") VALUES ('Team 1', CURRENT_TIMESTAMP), ('Team 2', CURRENT_TIMESTAMP), ('Team 3', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
