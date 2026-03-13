-- AlterTable: Add missing token listing checklist columns to TokenReview
ALTER TABLE "TokenReview" ADD COLUMN "jiraTicket" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TokenReview" ADD COLUMN "complianceDoc" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TokenReview" ADD COLUMN "launchDate" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TokenReview" ADD COLUMN "founders" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TokenReview" ADD COLUMN "website" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TokenReview" ADD COLUMN "supportedNetworks" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TokenReview" ADD COLUMN "whitepaper" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TokenReview" ADD COLUMN "explorer" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TokenReview" ADD COLUMN "blockchainAnalytics" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "TokenReview" ADD COLUMN "travelRuleNotabene" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TokenReview" ADD COLUMN "priceFeedCoingecko" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TokenReview" ADD COLUMN "consensusMechanism" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TokenReview" ADD COLUMN "privacyToken" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TokenReview" ADD COLUMN "jurisdictionStatus" TEXT NOT NULL DEFAULT '';
