-- CreateTable: TravelRuleCase
CREATE TABLE "TravelRuleCase" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL DEFAULT '',
    "direction" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "senderAddress" TEXT NOT NULL DEFAULT '',
    "receiverAddress" TEXT NOT NULL DEFAULT '',
    "matchStatus" TEXT NOT NULL,
    "notabeneTransferId" TEXT,
    "ownerUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "resolutionType" TEXT,
    "resolutionNote" TEXT NOT NULL DEFAULT '',
    "emailSentTo" TEXT,
    "emailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "TravelRuleCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable: VaspContact
CREATE TABLE "VaspContact" (
    "id" TEXT NOT NULL,
    "vaspDid" TEXT NOT NULL,
    "vaspName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaspContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TravelRuleCase_transactionId_matchStatus_key" ON "TravelRuleCase"("transactionId", "matchStatus");

-- CreateIndex
CREATE UNIQUE INDEX "VaspContact_vaspDid_key" ON "VaspContact"("vaspDid");
