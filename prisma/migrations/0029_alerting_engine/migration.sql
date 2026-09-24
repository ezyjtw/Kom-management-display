-- Spec §11: alerting engine state, OES windows, asset thresholds, risk rule tiers.

ALTER TABLE "Alert" ADD COLUMN IF NOT EXISTS "detail" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Alert" ADD COLUMN IF NOT EXISTS "exposureUsd" DOUBLE PRECISION;
ALTER TABLE "Alert" ADD COLUMN IF NOT EXISTS "cleanRuns" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Alert" ADD COLUMN IF NOT EXISTS "lastNotifiedAt" TIMESTAMP(3);
ALTER TABLE "Alert" ADD COLUMN IF NOT EXISTS "escalationStep" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Alert" ADD COLUMN IF NOT EXISTS "digestedAt" TIMESTAMP(3);

ALTER TABLE "AlertRule" ADD COLUMN IF NOT EXISTS "lastEvaluatedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "OesWindow" (
    "id" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "durationMins" INTEGER NOT NULL,
    "referenceTz" TEXT NOT NULL DEFAULT 'UTC',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OesWindow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OesWindow_exchange_cron_key" ON "OesWindow"("exchange", "cron");

CREATE TABLE IF NOT EXISTS "AssetThreshold" (
    "asset" TEXT NOT NULL,
    "stuckMins" INTEGER NOT NULL DEFAULT 120,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssetThreshold_pkey" PRIMARY KEY ("asset")
);

CREATE TABLE IF NOT EXISTS "RiskRuleTier" (
    "rule" INTEGER NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'high',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RiskRuleTier_pkey" PRIMARY KEY ("rule")
);

-- Seeds. TODO(CONFIRM-OES-WINDOWS): OKX reference time conflicts (UTC vs "9am UK");
-- TODO(CONFIRM-DERIBIT): Deribit is moving into Coinbase. Bybit window length is not documented (30 min placeholder).
INSERT INTO "OesWindow" ("id", "exchange", "cron", "durationMins", "referenceTz", "updatedAt") VALUES
  ('oes-deribit', 'deribit', '15 9 * * *', 15, 'UTC', CURRENT_TIMESTAMP),
  ('oes-bybit', 'bybit', '0 */6 * * *', 30, 'UTC', CURRENT_TIMESTAMP),
  ('oes-okx', 'okx', '0 9 * * *', 30, 'UTC', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

INSERT INTO "AssetThreshold" ("asset", "stuckMins", "updatedAt") VALUES ('*', 120, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- Current approved flow: every GX risk rule is treated as High (TODO(CONFIRM-RISKCO)).
INSERT INTO "RiskRuleTier" ("rule", "tier", "note", "updatedAt")
SELECT n, 'high', 'Current approved flow', CURRENT_TIMESTAMP FROM generate_series(1, 12) AS n
ON CONFLICT DO NOTHING;
