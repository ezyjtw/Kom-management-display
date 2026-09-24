-- Phase 9 (spec §14.3): lead handover for the morning call.
CREATE TABLE "LeadHandover" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "leadEmployeeId" TEXT NOT NULL,
    "absent" BOOLEAN NOT NULL DEFAULT true,
    "absenceSource" TEXT NOT NULL DEFAULT 'manual',
    "coveringEmployeeId" TEXT,
    "note" TEXT,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "postStatus" TEXT NOT NULL DEFAULT 'pending',
    "postAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastPostAttemptAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "postResults" JSONB NOT NULL DEFAULT '[]',
    "missingNotifiedAt" TIMESTAMP(3),
    "reminderResults" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeadHandover_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LeadHandover_date_team_key" ON "LeadHandover"("date", "team");
