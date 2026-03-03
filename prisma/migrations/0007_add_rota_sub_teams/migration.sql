-- CreateTable: SubTeam
CREATE TABLE "SubTeam" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentTeam" TEXT NOT NULL DEFAULT 'Transaction Operations',
    "description" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable: RotaAssignment
CREATE TABLE "RotaAssignment" (
    "id" TEXT NOT NULL,
    "subTeamId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "rotationCycle" TEXT NOT NULL DEFAULT 'weekly',
    "shiftType" TEXT NOT NULL DEFAULT 'standard',
    "isWfh" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT NOT NULL DEFAULT 'London',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RotaAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RotaAssignment_subTeamId_employeeId_startDate_key" ON "RotaAssignment"("subTeamId", "employeeId", "startDate");

-- AddForeignKey
ALTER TABLE "RotaAssignment" ADD CONSTRAINT "RotaAssignment_subTeamId_fkey" FOREIGN KEY ("subTeamId") REFERENCES "SubTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotaAssignment" ADD CONSTRAINT "RotaAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
