-- AlterTable: add smart contract review fields to TokenReview
ALTER TABLE "TokenReview" ADD COLUMN IF NOT EXISTS "smartContractReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TokenReview" ADD COLUMN IF NOT EXISTS "smartContractReviewNotes" TEXT NOT NULL DEFAULT '';
