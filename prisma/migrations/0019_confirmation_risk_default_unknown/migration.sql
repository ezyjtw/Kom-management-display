-- Separate from 0018: a newly added enum value cannot be used in the same
-- transaction that adds it. H5: risk comes from GX; absent that it is unknown.
ALTER TABLE "TransactionConfirmation" ALTER COLUMN "riskLevel" SET DEFAULT 'unknown';
