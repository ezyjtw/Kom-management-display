-- Phase 12f: reconcile schema drift (docs/phase1/schema-drift.md).
--
-- schema.prisma was aligned to the database where the database was right:
-- JSON-bearing TEXT columns stay TEXT (the code stores and parses JSON strings;
-- converting would change every reader and the AuditLog triggers), foreign keys
-- keep RESTRICT / SET NULL (evidence is never cascade-deleted), the archived
-- approval table (H1) is declared read-only and never dropped, and the two
-- extra indexes are declared. This migration adds what the database lacked.

-- 1. User.employeeId must be unique and must reference an Employee, so one
--    employee cannot be two logins and the audit actor stays unambiguous.
DO $$
DECLARE dup text;
BEGIN
  SELECT string_agg(DISTINCT "employeeId", ', ') INTO dup
  FROM "User" WHERE "employeeId" IS NOT NULL
  GROUP BY "employeeId" HAVING count(*) > 1;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0043 stopped: several users share an employee (%). Decide which login is correct, unlink the others (User.employeeId = NULL), then deploy again.', dup;
  END IF;
END $$;

-- Links to an employee that no longer exists are cleared, and the change is recorded.
DO $$
DECLARE orphans text; n int;
BEGIN
  SELECT string_agg(u.id, ', '), count(*) INTO orphans, n
  FROM "User" u LEFT JOIN "Employee" e ON e.id = u."employeeId"
  WHERE u."employeeId" IS NOT NULL AND e.id IS NULL;
  IF n > 0 THEN
    UPDATE "User" u SET "employeeId" = NULL
    WHERE u."employeeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Employee" e WHERE e.id = u."employeeId");
    INSERT INTO "AuditLog" (id, action, "entityType", "entityId", "userId", "actorType", details, phase, "createdAt")
    VALUES ('mig0043-' || md5(orphans), 'user_employee_link_cleared', 'user', 'migration_0043', 'system', 'system',
            json_build_object('summary', 'Migration 0043 cleared links to deleted employees', 'metadata', json_build_object('userIds', orphans, 'count', n))::text,
            'recorded', CURRENT_TIMESTAMP);
  END IF;
END $$;

CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");
ALTER TABLE "User" ADD CONSTRAINT "User_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Incident: backfill, then the defaults the schema declares.
UPDATE "Incident" SET "affectedServices" = '[]' WHERE "affectedServices" IS NULL;
UPDATE "Incident" SET "detectionSource" = 'manual' WHERE "detectionSource" IS NULL;
ALTER TABLE "Incident" ALTER COLUMN "affectedServices" SET NOT NULL,
ALTER COLUMN "affectedServices" SET DEFAULT '[]',
ALTER COLUMN "detectionSource" SET NOT NULL,
ALTER COLUMN "detectionSource" SET DEFAULT 'manual';
ALTER TABLE "KnowledgeScore" ALTER COLUMN "scoredBy" SET DEFAULT '';

-- 3. Indexes the schema declares (query performance; AuditLog (action, createdAt) serves the ALR-SEC and ALR-AUD evaluators).
CREATE INDEX IF NOT EXISTS "Alert_threadId_idx" ON "Alert"("threadId");
CREATE INDEX IF NOT EXISTS "Alert_employeeId_idx" ON "Alert"("employeeId");
CREATE INDEX IF NOT EXISTS "Alert_travelRuleCaseId_idx" ON "Alert"("travelRuleCaseId");
CREATE INDEX IF NOT EXISTS "Alert_status_idx" ON "Alert"("status");
CREATE INDEX IF NOT EXISTS "Alert_type_idx" ON "Alert"("type");
CREATE INDEX IF NOT EXISTS "Alert_type_status_idx" ON "Alert"("type", "status");
CREATE INDEX IF NOT EXISTS "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "CaseNote_caseId_idx" ON "CaseNote"("caseId");
CREATE INDEX IF NOT EXISTS "CommsMessage_threadId_idx" ON "CommsMessage"("threadId");
CREATE INDEX IF NOT EXISTS "CommsThread_ownerUserId_idx" ON "CommsThread"("ownerUserId");
CREATE INDEX IF NOT EXISTS "CommsThread_status_idx" ON "CommsThread"("status");
CREATE INDEX IF NOT EXISTS "CommsThread_queue_idx" ON "CommsThread"("queue");
CREATE INDEX IF NOT EXISTS "CommsThread_createdAt_idx" ON "CommsThread"("createdAt");
CREATE INDEX IF NOT EXISTS "CommsThread_source_sourceThreadRef_idx" ON "CommsThread"("source", "sourceThreadRef");
CREATE INDEX IF NOT EXISTS "CommsThread_status_queue_idx" ON "CommsThread"("status", "queue");
CREATE INDEX IF NOT EXISTS "CommsThread_ownerUserId_status_idx" ON "CommsThread"("ownerUserId", "status");
CREATE INDEX IF NOT EXISTS "CommsThread_priority_ttoDeadline_idx" ON "CommsThread"("priority", "ttoDeadline");
CREATE INDEX IF NOT EXISTS "CommsThread_lastMessageAt_idx" ON "CommsThread"("lastMessageAt");
CREATE INDEX IF NOT EXISTS "Employee_team_active_idx" ON "Employee"("team", "active");
CREATE INDEX IF NOT EXISTS "EmployeeNote_employeeId_idx" ON "EmployeeNote"("employeeId");
CREATE INDEX IF NOT EXISTS "Incident_severity_status_idx" ON "Incident"("severity", "status");
CREATE INDEX IF NOT EXISTS "IncidentUpdate_incidentId_idx" ON "IncidentUpdate"("incidentId");
CREATE INDEX IF NOT EXISTS "OwnershipChange_threadId_idx" ON "OwnershipChange"("threadId");
CREATE INDEX IF NOT EXISTS "OwnershipChange_changedAt_idx" ON "OwnershipChange"("changedAt");
CREATE INDEX IF NOT EXISTS "ThreadNote_threadId_idx" ON "ThreadNote"("threadId");
CREATE INDEX IF NOT EXISTS "TravelRuleCase_ownerUserId_idx" ON "TravelRuleCase"("ownerUserId");
CREATE INDEX IF NOT EXISTS "TravelRuleCase_status_idx" ON "TravelRuleCase"("status");
CREATE INDEX IF NOT EXISTS "TravelRuleCase_createdAt_idx" ON "TravelRuleCase"("createdAt");
CREATE INDEX IF NOT EXISTS "TravelRuleCase_status_ownerUserId_idx" ON "TravelRuleCase"("status", "ownerUserId");
CREATE INDEX IF NOT EXISTS "TravelRuleCase_slaDeadline_idx" ON "TravelRuleCase"("slaDeadline");
