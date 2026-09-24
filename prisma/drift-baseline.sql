-- DropForeignKey
ALTER TABLE "Alert" DROP CONSTRAINT "Alert_threadId_fkey";

-- DropForeignKey
ALTER TABLE "Alert" DROP CONSTRAINT "Alert_travelRuleCaseId_fkey";

-- DropForeignKey
ALTER TABLE "CaseNote" DROP CONSTRAINT "CaseNote_caseId_fkey";

-- DropForeignKey
ALTER TABLE "CommsMessage" DROP CONSTRAINT "CommsMessage_threadId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeNote" DROP CONSTRAINT "EmployeeNote_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "IncidentUpdate" DROP CONSTRAINT "IncidentUpdate_incidentId_fkey";

-- DropForeignKey
ALTER TABLE "OwnershipChange" DROP CONSTRAINT "OwnershipChange_threadId_fkey";

-- DropForeignKey
ALTER TABLE "ThreadNote" DROP CONSTRAINT "ThreadNote_threadId_fkey";

-- DropIndex
DROP INDEX "AuditLog_userId_action_idx";

-- DropIndex
DROP INDEX "SessionMetadata_userId_expiresAt_idx";

-- AlterTable
ALTER TABLE "AuditLog" DROP COLUMN "details",
ADD COLUMN     "details" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "CategoryScore" DROP COLUMN "evidence",
ADD COLUMN     "evidence" JSONB NOT NULL DEFAULT '[]',
DROP COLUMN "metadata",
ADD COLUMN     "metadata" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "CommsMessage" DROP COLUMN "attachments",
ADD COLUMN     "attachments" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "CommsThread" DROP COLUMN "participants",
ADD COLUMN     "participants" JSONB NOT NULL DEFAULT '[]',
DROP COLUMN "linkedRecords",
ADD COLUMN     "linkedRecords" JSONB NOT NULL DEFAULT '[]',
DROP COLUMN "secondaryOwnerIds",
ADD COLUMN     "secondaryOwnerIds" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Incident" DROP COLUMN "linkedThreadIds",
ADD COLUMN     "linkedThreadIds" JSONB NOT NULL DEFAULT '[]',
DROP COLUMN "linkedTransactionIds",
ADD COLUMN     "linkedTransactionIds" JSONB NOT NULL DEFAULT '[]',
DROP COLUMN "rcaFollowUpItems",
ADD COLUMN     "rcaFollowUpItems" JSONB NOT NULL DEFAULT '[]',
ALTER COLUMN "affectedServices" SET NOT NULL,
ALTER COLUMN "affectedServices" SET DEFAULT '[]',
ALTER COLUMN "detectionSource" SET NOT NULL,
ALTER COLUMN "detectionSource" SET DEFAULT 'manual';

-- AlterTable
ALTER TABLE "KnowledgeScore" ALTER COLUMN "scoredBy" SET DEFAULT '';

-- AlterTable
ALTER TABLE "Project" DROP COLUMN "tags",
ADD COLUMN     "tags" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "StakingWallet" DROP COLUMN "tags",
ADD COLUMN     "tags" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "UsdcRampRequest" DROP COLUMN "evidence",
ADD COLUMN     "evidence" JSONB NOT NULL DEFAULT '[]';

-- DropTable
DROP TABLE "_archived_approval_audit_entry";

-- CreateIndex
CREATE INDEX "Alert_threadId_idx" ON "Alert"("threadId");

-- CreateIndex
CREATE INDEX "Alert_employeeId_idx" ON "Alert"("employeeId");

-- CreateIndex
CREATE INDEX "Alert_travelRuleCaseId_idx" ON "Alert"("travelRuleCaseId");

-- CreateIndex
CREATE INDEX "Alert_status_idx" ON "Alert"("status");

-- CreateIndex
CREATE INDEX "Alert_type_idx" ON "Alert"("type");

-- CreateIndex
CREATE INDEX "Alert_type_status_idx" ON "Alert"("type", "status");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "CaseNote_caseId_idx" ON "CaseNote"("caseId");

-- CreateIndex
CREATE INDEX "CommsMessage_threadId_idx" ON "CommsMessage"("threadId");

-- CreateIndex
CREATE INDEX "CommsThread_ownerUserId_idx" ON "CommsThread"("ownerUserId");

-- CreateIndex
CREATE INDEX "CommsThread_status_idx" ON "CommsThread"("status");

-- CreateIndex
CREATE INDEX "CommsThread_queue_idx" ON "CommsThread"("queue");

-- CreateIndex
CREATE INDEX "CommsThread_createdAt_idx" ON "CommsThread"("createdAt");

-- CreateIndex
CREATE INDEX "CommsThread_source_sourceThreadRef_idx" ON "CommsThread"("source", "sourceThreadRef");

-- CreateIndex
CREATE INDEX "CommsThread_status_queue_idx" ON "CommsThread"("status", "queue");

-- CreateIndex
CREATE INDEX "CommsThread_ownerUserId_status_idx" ON "CommsThread"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "CommsThread_priority_ttoDeadline_idx" ON "CommsThread"("priority", "ttoDeadline");

-- CreateIndex
CREATE INDEX "CommsThread_lastMessageAt_idx" ON "CommsThread"("lastMessageAt");

-- CreateIndex
CREATE INDEX "Employee_team_active_idx" ON "Employee"("team", "active");

-- CreateIndex
CREATE INDEX "EmployeeNote_employeeId_idx" ON "EmployeeNote"("employeeId");

-- CreateIndex
CREATE INDEX "Incident_severity_status_idx" ON "Incident"("severity", "status");

-- CreateIndex
CREATE INDEX "IncidentUpdate_incidentId_idx" ON "IncidentUpdate"("incidentId");

-- CreateIndex
CREATE INDEX "OwnershipChange_threadId_idx" ON "OwnershipChange"("threadId");

-- CreateIndex
CREATE INDEX "OwnershipChange_changedAt_idx" ON "OwnershipChange"("changedAt");

-- CreateIndex
CREATE INDEX "ThreadNote_threadId_idx" ON "ThreadNote"("threadId");

-- CreateIndex
CREATE INDEX "TravelRuleCase_ownerUserId_idx" ON "TravelRuleCase"("ownerUserId");

-- CreateIndex
CREATE INDEX "TravelRuleCase_status_idx" ON "TravelRuleCase"("status");

-- CreateIndex
CREATE INDEX "TravelRuleCase_createdAt_idx" ON "TravelRuleCase"("createdAt");

-- CreateIndex
CREATE INDEX "TravelRuleCase_status_ownerUserId_idx" ON "TravelRuleCase"("status", "ownerUserId");

-- CreateIndex
CREATE INDEX "TravelRuleCase_slaDeadline_idx" ON "TravelRuleCase"("slaDeadline");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeNote" ADD CONSTRAINT "EmployeeNote_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsMessage" ADD CONSTRAINT "CommsMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommsThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipChange" ADD CONSTRAINT "OwnershipChange_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommsThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThreadNote" ADD CONSTRAINT "ThreadNote_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommsThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "TravelRuleCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommsThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_travelRuleCaseId_fkey" FOREIGN KEY ("travelRuleCaseId") REFERENCES "TravelRuleCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentUpdate" ADD CONSTRAINT "IncidentUpdate_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

