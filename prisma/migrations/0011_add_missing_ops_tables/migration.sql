-- AlterTable: Incident — add RCA tracker and external ticket columns (missing from 0009)
ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "rcaStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "rcaDocumentRef" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "rcaResponsibleId" TEXT;
ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "rcaSlaDeadline" TIMESTAMP(3);
ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "rcaReceivedAt" TIMESTAMP(3);
ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "rcaFollowUpItems" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "rcaRaisedAt" TIMESTAMP(3);
ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "externalTicketRef" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "externalTicketUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "externalTicketStatus" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "externalTicketLastSyncAt" TIMESTAMP(3);
ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "externalTicketDisputed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "externalTicketDisputeReason" TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS "Incident_rcaStatus_idx" ON "Incident"("rcaStatus");
CREATE INDEX IF NOT EXISTS "Incident_externalTicketRef_idx" ON "Incident"("externalTicketRef");

-- AddForeignKey: Incident.rcaResponsibleId -> Employee
DO $$ BEGIN
  ALTER TABLE "Incident" ADD CONSTRAINT "Incident_rcaResponsibleId_fkey" FOREIGN KEY ("rcaResponsibleId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable: ExternalTicketEvent
CREATE TABLE "ExternalTicketEvent" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL DEFAULT '',
    "toStatus" TEXT NOT NULL DEFAULT '',
    "performedBy" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "jiraComment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalTicketEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExternalTicketEvent_incidentId_idx" ON "ExternalTicketEvent"("incidentId");
ALTER TABLE "ExternalTicketEvent" ADD CONSTRAINT "ExternalTicketEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: OesSettlement
CREATE TABLE "OesSettlement" (
    "id" TEXT NOT NULL,
    "settlementRef" TEXT NOT NULL,
    "venue" TEXT NOT NULL DEFAULT 'okx',
    "clientName" TEXT NOT NULL,
    "clientAccount" TEXT NOT NULL DEFAULT '',
    "asset" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "direction" TEXT NOT NULL,
    "settlementCycle" TEXT NOT NULL DEFAULT '',
    "exchangeInstructionId" TEXT NOT NULL DEFAULT '',
    "onChainTxHash" TEXT NOT NULL DEFAULT '',
    "collateralWallet" TEXT NOT NULL DEFAULT '',
    "custodyWallet" TEXT NOT NULL DEFAULT '',
    "matchStatus" TEXT NOT NULL DEFAULT 'pending',
    "matchNote" TEXT NOT NULL DEFAULT '',
    "delegationStatus" TEXT NOT NULL DEFAULT 'n/a',
    "delegatedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "makerById" TEXT,
    "makerAt" TIMESTAMP(3),
    "checkerById" TEXT,
    "checkerAt" TIMESTAMP(3),
    "escalationNote" TEXT NOT NULL DEFAULT '',
    "fireblockssTxId" TEXT NOT NULL DEFAULT '',
    "oesSignerGroup" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OesSettlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OesSettlement_settlementRef_key" ON "OesSettlement"("settlementRef");
CREATE INDEX "OesSettlement_status_idx" ON "OesSettlement"("status");
CREATE INDEX "OesSettlement_matchStatus_idx" ON "OesSettlement"("matchStatus");
CREATE INDEX "OesSettlement_clientName_idx" ON "OesSettlement"("clientName");
CREATE INDEX "OesSettlement_venue_idx" ON "OesSettlement"("venue");
CREATE INDEX "OesSettlement_settlementCycle_idx" ON "OesSettlement"("settlementCycle");

-- CreateTable: UsdcRampRequest
CREATE TABLE "UsdcRampRequest" (
    "id" TEXT NOT NULL,
    "ticketRef" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientAccount" TEXT NOT NULL DEFAULT '',
    "direction" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "fiatCurrency" TEXT NOT NULL DEFAULT 'USD',
    "fiatAmount" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'instruction_received',
    "bankReference" TEXT NOT NULL DEFAULT '',
    "instructionRef" TEXT NOT NULL DEFAULT '',
    "ssiVerified" BOOLEAN NOT NULL DEFAULT false,
    "ssiDetails" TEXT NOT NULL DEFAULT '',
    "custodyWalletId" TEXT NOT NULL DEFAULT '',
    "holdingWalletId" TEXT NOT NULL DEFAULT '',
    "onChainTxHash" TEXT NOT NULL DEFAULT '',
    "gasWalletOk" BOOLEAN NOT NULL DEFAULT true,
    "issuerConfirmation" TEXT NOT NULL DEFAULT '',
    "expressEnabled" BOOLEAN NOT NULL DEFAULT true,
    "feesFromBuffer" BOOLEAN NOT NULL DEFAULT true,
    "feeBufferLow" BOOLEAN NOT NULL DEFAULT false,
    "makerById" TEXT,
    "makerAt" TIMESTAMP(3),
    "makerNote" TEXT NOT NULL DEFAULT '',
    "checkerById" TEXT,
    "checkerAt" TIMESTAMP(3),
    "checkerNote" TEXT NOT NULL DEFAULT '',
    "kycAmlOk" BOOLEAN NOT NULL DEFAULT false,
    "walletWhitelisted" BOOLEAN NOT NULL DEFAULT false,
    "evidence" TEXT NOT NULL DEFAULT '[]',
    "notes" TEXT NOT NULL DEFAULT '',
    "rejectionReason" TEXT NOT NULL DEFAULT '',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "clientNotifiedAt" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsdcRampRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UsdcRampRequest_ticketRef_key" ON "UsdcRampRequest"("ticketRef");
CREATE INDEX "UsdcRampRequest_status_idx" ON "UsdcRampRequest"("status");
CREATE INDEX "UsdcRampRequest_clientName_idx" ON "UsdcRampRequest"("clientName");
CREATE INDEX "UsdcRampRequest_direction_idx" ON "UsdcRampRequest"("direction");
CREATE INDEX "UsdcRampRequest_ticketRef_idx" ON "UsdcRampRequest"("ticketRef");

-- CreateTable: StakingWallet
CREATE TABLE "StakingWallet" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "validator" TEXT NOT NULL DEFAULT '',
    "stakedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rewardModel" TEXT NOT NULL,
    "clientName" TEXT NOT NULL DEFAULT '',
    "isColdStaking" BOOLEAN NOT NULL DEFAULT false,
    "isTestWallet" BOOLEAN NOT NULL DEFAULT false,
    "stakeDate" TIMESTAMP(3),
    "expectedFirstRewardDate" TIMESTAMP(3),
    "actualFirstRewardDate" TIMESTAMP(3),
    "lastRewardAt" TIMESTAMP(3),
    "expectedNextRewardAt" TIMESTAMP(3),
    "onChainBalance" DOUBLE PRECISION,
    "platformBalance" DOUBLE PRECISION,
    "varianceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.01,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "notes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StakingWallet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StakingWallet_walletAddress_key" ON "StakingWallet"("walletAddress");
CREATE INDEX "StakingWallet_asset_idx" ON "StakingWallet"("asset");
CREATE INDEX "StakingWallet_rewardModel_idx" ON "StakingWallet"("rewardModel");
CREATE INDEX "StakingWallet_status_idx" ON "StakingWallet"("status");

-- CreateTable: DailyCheckRun
CREATE TABLE "DailyCheckRun" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "operatorId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "jiraSummary" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyCheckRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyCheckRun_date_key" ON "DailyCheckRun"("date");
CREATE INDEX "DailyCheckRun_date_idx" ON "DailyCheckRun"("date");

-- CreateTable: DailyCheckItem
CREATE TABLE "DailyCheckItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "autoCheckKey" TEXT NOT NULL DEFAULT '',
    "autoResult" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "operatorId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyCheckItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DailyCheckItem_runId_idx" ON "DailyCheckItem"("runId");
CREATE INDEX "DailyCheckItem_category_idx" ON "DailyCheckItem"("category");
ALTER TABLE "DailyCheckItem" ADD CONSTRAINT "DailyCheckItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DailyCheckRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: ScreeningEntry
CREATE TABLE "ScreeningEntry" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL DEFAULT '',
    "asset" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "direction" TEXT NOT NULL DEFAULT 'IN',
    "screeningStatus" TEXT NOT NULL DEFAULT 'not_submitted',
    "classification" TEXT NOT NULL DEFAULT 'unclassified',
    "isKnownException" BOOLEAN NOT NULL DEFAULT false,
    "exceptionReason" TEXT NOT NULL DEFAULT '',
    "analyticsAlertId" TEXT NOT NULL DEFAULT '',
    "analyticsStatus" TEXT NOT NULL DEFAULT 'none',
    "complianceReviewStatus" TEXT NOT NULL DEFAULT 'none',
    "reclassifiedAt" TIMESTAMP(3),
    "reclassifiedById" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreeningEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScreeningEntry_transactionId_key" ON "ScreeningEntry"("transactionId");
CREATE INDEX "ScreeningEntry_screeningStatus_idx" ON "ScreeningEntry"("screeningStatus");
CREATE INDEX "ScreeningEntry_classification_idx" ON "ScreeningEntry"("classification");
CREATE INDEX "ScreeningEntry_asset_idx" ON "ScreeningEntry"("asset");

-- CreateTable: ApprovalAuditEntry
CREATE TABLE "ApprovalAuditEntry" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "performedById" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL DEFAULT 'medium',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalAuditEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApprovalAuditEntry_requestId_idx" ON "ApprovalAuditEntry"("requestId");
CREATE INDEX "ApprovalAuditEntry_performedById_idx" ON "ApprovalAuditEntry"("performedById");

-- CreateTable: TokenReview
CREATE TABLE "TokenReview" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "network" TEXT NOT NULL DEFAULT '',
    "contractAddress" TEXT NOT NULL DEFAULT '',
    "tokenType" TEXT NOT NULL DEFAULT 'native',
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "proposedById" TEXT,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "complianceById" TEXT,
    "complianceAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "liveAt" TIMESTAMP(3),
    "rejectionReason" TEXT NOT NULL DEFAULT '',
    "riskLevel" TEXT NOT NULL DEFAULT 'medium',
    "riskNotes" TEXT NOT NULL DEFAULT '',
    "regulatoryNotes" TEXT NOT NULL DEFAULT '',
    "sanctionsCheck" BOOLEAN NOT NULL DEFAULT false,
    "amlRiskAssessed" BOOLEAN NOT NULL DEFAULT false,
    "custodianSupport" TEXT NOT NULL DEFAULT '[]',
    "stakingAvailable" BOOLEAN NOT NULL DEFAULT false,
    "chainalysisSupport" TEXT NOT NULL DEFAULT 'unknown',
    "notabeneSupport" TEXT NOT NULL DEFAULT 'unknown',
    "fireblocksSupport" TEXT NOT NULL DEFAULT 'unknown',
    "ledgerSupport" TEXT NOT NULL DEFAULT 'unknown',
    "vendorNotes" TEXT NOT NULL DEFAULT '',
    "demandScore" INTEGER NOT NULL DEFAULT 0,
    "aiResearchResult" TEXT NOT NULL DEFAULT '',
    "aiResearchedAt" TIMESTAMP(3),
    "aiRecommendation" TEXT NOT NULL DEFAULT '',
    "marketCapTier" TEXT NOT NULL DEFAULT 'unknown',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TokenReview_symbol_network_key" ON "TokenReview"("symbol", "network");
CREATE INDEX "TokenReview_status_idx" ON "TokenReview"("status");
CREATE INDEX "TokenReview_riskLevel_idx" ON "TokenReview"("riskLevel");
CREATE INDEX "TokenReview_demandScore_idx" ON "TokenReview"("demandScore");

-- CreateTable: TokenDemandSignal
CREATE TABLE "TokenDemandSignal" (
    "id" TEXT NOT NULL,
    "tokenReviewId" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "weight" INTEGER NOT NULL DEFAULT 1,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenDemandSignal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TokenDemandSignal_tokenReviewId_idx" ON "TokenDemandSignal"("tokenReviewId");
ALTER TABLE "TokenDemandSignal" ADD CONSTRAINT "TokenDemandSignal_tokenReviewId_fkey" FOREIGN KEY ("tokenReviewId") REFERENCES "TokenReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
