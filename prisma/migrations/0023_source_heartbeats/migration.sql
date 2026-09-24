-- Spec §7.5

-- CreateTable
CREATE TABLE IF NOT EXISTS "SourceHeartbeat" (
    "source" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastRecordAt" TIMESTAMP(3),
    "lastCount" INTEGER NOT NULL DEFAULT 0,
    "expectedEveryMins" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceHeartbeat_pkey" PRIMARY KEY ("source")
);
