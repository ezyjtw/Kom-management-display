-- Spec §12 Team 1: incident tickets, settlement notes, FAB register (behind module.fab).

ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "workItemId" TEXT;

CREATE TABLE IF NOT EXISTS "SettlementNote" (
    "id" TEXT NOT NULL,
    "windowKey" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SettlementNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SettlementNote_windowKey_idx" ON "SettlementNote"("windowKey");

CREATE TABLE IF NOT EXISTS "FabInstruction" (
    "id" TEXT NOT NULL,
    "messageType" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "instructionType" TEXT NOT NULL DEFAULT '',
    "direction" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "valueDate" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "ackStatus" TEXT NOT NULL DEFAULT 'none',
    "ackSentAt" TIMESTAMP(3),
    "correctedByRef" TEXT,
    "sourceMessageId" TEXT,
    "workItemId" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FabInstruction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FabInstruction_reference_key" ON "FabInstruction"("reference");
CREATE INDEX IF NOT EXISTS "FabInstruction_ackStatus_idx" ON "FabInstruction"("ackStatus");
CREATE INDEX IF NOT EXISTS "FabInstruction_valueDate_idx" ON "FabInstruction"("valueDate");

CREATE TABLE IF NOT EXISTS "FabSettlementLog" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "txHash" TEXT,
    "kytStatus" TEXT NOT NULL DEFAULT 'none',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FabSettlementLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FabSettlementLog_reference_idx" ON "FabSettlementLog"("reference");
CREATE INDEX IF NOT EXISTS "FabSettlementLog_status_idx" ON "FabSettlementLog"("status");

CREATE TABLE IF NOT EXISTS "FabFeeBalance" (
    "id" TEXT NOT NULL,
    "walletRef" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT,
    CONSTRAINT "FabFeeBalance_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FabFeeBalance_walletRef_recordedAt_idx" ON "FabFeeBalance"("walletRef", "recordedAt");
