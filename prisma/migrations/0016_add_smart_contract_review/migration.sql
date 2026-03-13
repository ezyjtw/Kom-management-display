-- AlterTable: add smart contract review fields to TokenReview
ALTER TABLE "TokenReview" ADD COLUMN "smartContractReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TokenReview" ADD COLUMN "smartContractReviewNotes" TEXT NOT NULL DEFAULT '';
