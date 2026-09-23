-- Phase 0 §5.2: TransactionConfirmation becomes a read-only tracker of GX
-- risk-flagged transactions awaiting human action in GX.

ALTER TYPE "TransactionRiskLevel" ADD VALUE IF NOT EXISTS 'unknown';

ALTER TYPE "ConfirmationStatus" RENAME VALUE 'acknowledged' TO 'owned';
ALTER TYPE "ConfirmationStatus" RENAME VALUE 'signed_off' TO 'closed_in_source';

ALTER TABLE "TransactionConfirmation" RENAME COLUMN "acknowledgedById" TO "ownedById";
ALTER TABLE "TransactionConfirmation" RENAME COLUMN "acknowledgedAt" TO "ownedAt";
-- Historical sign-offs keep their actor; automatic closures leave it null.
ALTER TABLE "TransactionConfirmation" RENAME COLUMN "signedOffById" TO "closedById";
ALTER TABLE "TransactionConfirmation" RENAME COLUMN "signedOffAt" TO "closedInSourceAt";
ALTER TABLE "TransactionConfirmation" ADD COLUMN "ticketRef" TEXT NOT NULL DEFAULT '';
