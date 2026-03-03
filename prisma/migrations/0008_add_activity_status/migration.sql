-- CreateTable
CREATE TABLE "ActivityStatus" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationMin" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityStatus_employeeId_startedAt_idx" ON "ActivityStatus"("employeeId", "startedAt");

-- CreateIndex
CREATE INDEX "ActivityStatus_endedAt_idx" ON "ActivityStatus"("endedAt");

-- AddForeignKey
ALTER TABLE "ActivityStatus" ADD CONSTRAINT "ActivityStatus_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
