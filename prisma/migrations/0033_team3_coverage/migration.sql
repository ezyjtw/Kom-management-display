-- Spec §12 Team 3: client-attested inbound thresholds and their review date (CHK-05, CF-31).
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "inboundThresholdUsd" DOUBLE PRECISION;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "thresholdReviewedAt" TIMESTAMP(3);
