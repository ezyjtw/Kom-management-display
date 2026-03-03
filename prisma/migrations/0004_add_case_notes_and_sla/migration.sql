-- AlterTable: TravelRuleCase - add SLA deadline
ALTER TABLE "TravelRuleCase" ADD COLUMN "slaDeadline" TIMESTAMP(3);

-- AlterTable: Alert - add travel rule case relation
ALTER TABLE "Alert" ADD COLUMN "travelRuleCaseId" TEXT;

-- CreateTable: CaseNote
CREATE TABLE "CaseNote" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseNote_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey: CaseNote -> TravelRuleCase
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "TravelRuleCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: CaseNote -> Employee
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: Alert -> TravelRuleCase
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_travelRuleCaseId_fkey" FOREIGN KEY ("travelRuleCaseId") REFERENCES "TravelRuleCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
