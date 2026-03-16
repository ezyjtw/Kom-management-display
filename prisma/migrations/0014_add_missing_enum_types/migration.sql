-- ============================================================
-- Part 1: Create enums
-- ============================================================

CREATE TYPE "ThreadStatus" AS ENUM ('Unassigned', 'Assigned', 'InProgress', 'WaitingExternal', 'WaitingInternal', 'PendingHandover', 'Done', 'Closed');
CREATE TYPE "ThreadPriority" AS ENUM ('P0', 'P1', 'P2', 'P3');
CREATE TYPE "AlertSeverity" AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE "AlertStatus" AS ENUM ('active', 'acknowledged', 'resolved');
CREATE TYPE "TravelRuleCaseStatus" AS ENUM ('Open', 'Investigating', 'PendingResponse', 'Resolved', 'Escalated');
CREATE TYPE "TravelRuleResolutionType" AS ENUM ('info_obtained', 'email_sent', 'not_required', 'escalated');
CREATE TYPE "ProjectStatus" AS ENUM ('planned', 'active', 'on_hold', 'completed', 'cancelled');
CREATE TYPE "DailyCheckStatus" AS ENUM ('pending', 'pass', 'issues_found', 'skipped');
CREATE TYPE "IncidentSeverity" AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE "IncidentStatus" AS ENUM ('active', 'monitoring', 'resolved');
CREATE TYPE "CommsSource" AS ENUM ('email', 'slack', 'jira', 'manual');
CREATE TYPE "UserRole" AS ENUM ('admin', 'lead', 'employee', 'auditor');
CREATE TYPE "EmployeeRole" AS ENUM ('Analyst', 'Senior', 'Lead', 'Manager');
CREATE TYPE "TeamName" AS ENUM ('TransactionOperations', 'AdminOperations', 'DataOperations', 'StakingOps', 'Settlements');
CREATE TYPE "Region" AS ENUM ('Global', 'EMEA', 'APAC', 'Americas');
CREATE TYPE "TimePeriodType" AS ENUM ('week', 'month', 'quarter');
CREATE TYPE "ScoreCategory" AS ENUM ('daily_tasks', 'projects', 'asset_actions', 'quality', 'knowledge');
CREATE TYPE "TransactionRiskLevel" AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE "ConfirmationStatus" AS ENUM ('pending', 'acknowledged', 'signed_off', 'escalated', 'expired');
CREATE TYPE "JobStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'retrying');

-- ============================================================
-- Part 2: Add missing columns to existing tables
-- ============================================================

-- Alert: add severity column
ALTER TABLE "Alert" ADD COLUMN "severity" TEXT NOT NULL DEFAULT 'medium';

-- KnowledgeScore: add scoredById column
ALTER TABLE "KnowledgeScore" ADD COLUMN "scoredById" TEXT;

-- CommsThread: add Slack and AI columns
ALTER TABLE "CommsThread" ADD COLUMN "slackChannelId" TEXT;
ALTER TABLE "CommsThread" ADD COLUMN "slackRootTs" TEXT;
ALTER TABLE "CommsThread" ADD COLUMN "slackThreadTs" TEXT;
ALTER TABLE "CommsThread" ADD COLUMN "isSlackThread" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CommsThread" ADD COLUMN "slackReplyCount" INTEGER;
ALTER TABLE "CommsThread" ADD COLUMN "slackLastReplyTs" TEXT;
ALTER TABLE "CommsThread" ADD COLUMN "aiClassification" JSONB;
ALTER TABLE "CommsThread" ADD COLUMN "aiClassifiedAt" TIMESTAMP(3);
ALTER TABLE "CommsThread" ADD COLUMN "aiUrgencyScore" INTEGER NOT NULL DEFAULT 0;

-- CommsMessage: add Slack fields
ALTER TABLE "CommsMessage" ADD COLUMN "slackTs" TEXT;
ALTER TABLE "CommsMessage" ADD COLUMN "slackUserId" TEXT;
ALTER TABLE "CommsMessage" ADD COLUMN "slackThreadTs" TEXT;
ALTER TABLE "CommsMessage" ADD COLUMN "isRootMessage" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CommsMessage" ADD COLUMN "slackReactions" JSONB;
ALTER TABLE "CommsMessage" ADD COLUMN "editedAt" TIMESTAMP(3);

-- Incident: add service-provider/client-impact columns
ALTER TABLE "Incident" ADD COLUMN "affectedServices" JSONB;
ALTER TABLE "Incident" ADD COLUMN "detectionSource" TEXT;
ALTER TABLE "Incident" ADD COLUMN "clientImpactCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Incident" ADD COLUMN "clientNotifiedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Incident" ADD COLUMN "firstClientNotifiedAt" TIMESTAMP(3);

-- ============================================================
-- Part 3: Create missing tables
-- ============================================================

-- ThreadParticipant
CREATE TABLE "ThreadParticipant" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL,
    CONSTRAINT "ThreadParticipant_pkey" PRIMARY KEY ("id")
);

-- ThreadLinkedRecord
CREATE TABLE "ThreadLinkedRecord" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "ThreadLinkedRecord_pkey" PRIMARY KEY ("id")
);

-- MessageAttachment
CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "mimeType" TEXT NOT NULL DEFAULT '',
    "storageRef" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

-- ScoreEvidence
CREATE TABLE "ScoreEvidence" (
    "id" TEXT NOT NULL,
    "scoreId" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL DEFAULT '',
    "label" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ScoreEvidence_pkey" PRIMARY KEY ("id")
);

-- ProjectTag
CREATE TABLE "ProjectTag" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    CONSTRAINT "ProjectTag_pkey" PRIMARY KEY ("id")
);

-- WalletTag
CREATE TABLE "WalletTag" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    CONSTRAINT "WalletTag_pkey" PRIMARY KEY ("id")
);

-- ClientContactPreference
CREATE TABLE "ClientContactPreference" (
    "id" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "preferredChannel" TEXT NOT NULL DEFAULT 'email',
    "primaryEmail" TEXT NOT NULL DEFAULT '',
    "secondaryEmail" TEXT NOT NULL DEFAULT '',
    "slackChannel" TEXT NOT NULL DEFAULT '',
    "phoneNumber" TEXT NOT NULL DEFAULT '',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "businessHoursStart" TEXT NOT NULL DEFAULT '09:00',
    "businessHoursEnd" TEXT NOT NULL DEFAULT '17:00',
    "businessDays" TEXT NOT NULL DEFAULT 'mon,tue,wed,thu,fri',
    "language" TEXT NOT NULL DEFAULT 'en',
    "vaspDid" TEXT NOT NULL DEFAULT '',
    "travelRuleContact" TEXT NOT NULL DEFAULT '',
    "escalationEmail" TEXT NOT NULL DEFAULT '',
    "escalationPhone" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastContactedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClientContactPreference_pkey" PRIMARY KEY ("id")
);

-- WorkflowEvent
CREATE TABLE "WorkflowEvent" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT,
    "performedById" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkflowEvent_pkey" PRIMARY KEY ("id")
);

-- DataRetentionPolicy
CREATE TABLE "DataRetentionPolicy" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "archiveEnabled" BOOLEAN NOT NULL DEFAULT false,
    "purgeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DataRetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- WebhookEvent
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signature" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'received',
    "processedAt" TIMESTAMP(3),
    "failureReason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- SessionMetadata: already created in migration 0013

-- TransactionConfirmation (uses enum types directly)
CREATE TABLE "TransactionConfirmation" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "requestId" TEXT,
    "riskLevel" "TransactionRiskLevel" NOT NULL DEFAULT 'medium',
    "asset" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "direction" TEXT NOT NULL,
    "account" TEXT NOT NULL DEFAULT '',
    "workspace" TEXT NOT NULL DEFAULT '',
    "status" "ConfirmationStatus" NOT NULL DEFAULT 'pending',
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "signedOffById" TEXT,
    "signedOffAt" TIMESTAMP(3),
    "escalatedById" TEXT,
    "escalatedAt" TIMESTAMP(3),
    "escalationReason" TEXT NOT NULL DEFAULT '',
    "slackNotifiedAt" TIMESTAMP(3),
    "slackChannel" TEXT NOT NULL DEFAULT '',
    "slackMessageTs" TEXT NOT NULL DEFAULT '',
    "emailNotifiedAt" TIMESTAMP(3),
    "emailSentTo" TEXT NOT NULL DEFAULT '',
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TransactionConfirmation_pkey" PRIMARY KEY ("id")
);

-- FeatureFlag
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "roles" TEXT NOT NULL DEFAULT '[]',
    "teams" TEXT NOT NULL DEFAULT '[]',
    "percentage" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- BackgroundJob (uses enum type directly)
CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'pending',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "error" TEXT NOT NULL DEFAULT '',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cronExpression" TEXT NOT NULL DEFAULT '',
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 2,
    "deduplicationKey" TEXT,
    "deadLetteredAt" TIMESTAMP(3),
    "deadLetterReason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- SlackChannel
CREATE TABLE "SlackChannel" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "linkedEntityId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "syncCursor" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SlackChannel_pkey" PRIMARY KEY ("id")
);

-- ServiceProvider
CREATE TABLE "ServiceProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "services" JSONB NOT NULL,
    "slackChannelId" TEXT,
    "statusPageUrl" TEXT,
    "statusPageType" TEXT,
    "contactEmail" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ServiceProvider_pkey" PRIMARY KEY ("id")
);

-- ClientServiceDependency
CREATE TABLE "ClientServiceDependency" (
    "id" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL DEFAULT '',
    "providerId" TEXT NOT NULL,
    "serviceNames" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    CONSTRAINT "ClientServiceDependency_pkey" PRIMARY KEY ("id")
);

-- ClientImpactRecord
CREATE TABLE "ClientImpactRecord" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL DEFAULT '',
    "affectedServices" JSONB NOT NULL,
    "impactStatus" TEXT NOT NULL DEFAULT 'potential',
    "estimatedImpact" TEXT NOT NULL DEFAULT '',
    "clientNotifiedAt" TIMESTAMP(3),
    "notifiedByEmployeeId" TEXT,
    "impactStartAt" TIMESTAMP(3),
    "impactEndAt" TIMESTAMP(3),
    "impactDurationMins" INTEGER,
    CONSTRAINT "ClientImpactRecord_pkey" PRIMARY KEY ("id")
);

-- ClientCommsDraft
CREATE TABLE "ClientCommsDraft" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "clientImpactRecordId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "aiDraft" TEXT NOT NULL DEFAULT '',
    "finalMessage" TEXT NOT NULL DEFAULT '',
    "sendChannel" TEXT NOT NULL,
    "sendChannelId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approvedByEmployeeId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveryStatus" TEXT NOT NULL DEFAULT 'pending',
    "deliveryError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientCommsDraft_pkey" PRIMARY KEY ("id")
);

-- StatusPageEvent
CREATE TABLE "StatusPageEvent" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "affectedComponents" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "linkedThreadId" TEXT,
    "linkedIncidentId" TEXT,
    "rawPayload" JSONB NOT NULL,
    "polledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StatusPageEvent_pkey" PRIMARY KEY ("id")
);

-- VendorReliabilityScore
CREATE TABLE "VendorReliabilityScore" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "incidentCount" INTEGER NOT NULL DEFAULT 0,
    "avgResolutionMins" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "clientImpactCount" INTEGER NOT NULL DEFAULT 0,
    "rcaReceivedRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "disputeCount" INTEGER NOT NULL DEFAULT 0,
    "reliabilityScore" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VendorReliabilityScore_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- Part 4: Add unique constraints
-- ============================================================

ALTER TABLE "ClientContactPreference" ADD CONSTRAINT "ClientContactPreference_clientName_key" UNIQUE ("clientName");
ALTER TABLE "DataRetentionPolicy" ADD CONSTRAINT "DataRetentionPolicy_entityType_key" UNIQUE ("entityType");
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_source_eventId_key" UNIQUE ("source", "eventId");
-- SessionMetadata unique constraint already in migration 0013
ALTER TABLE "TransactionConfirmation" ADD CONSTRAINT "TransactionConfirmation_transactionId_key" UNIQUE ("transactionId");
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_key_key" UNIQUE ("key");
ALTER TABLE "SlackChannel" ADD CONSTRAINT "SlackChannel_channelId_key" UNIQUE ("channelId");
ALTER TABLE "ServiceProvider" ADD CONSTRAINT "ServiceProvider_name_key" UNIQUE ("name");
ALTER TABLE "ClientServiceDependency" ADD CONSTRAINT "ClientServiceDependency_clientName_providerId_key" UNIQUE ("clientName", "providerId");
ALTER TABLE "ClientImpactRecord" ADD CONSTRAINT "ClientImpactRecord_incidentId_clientName_key" UNIQUE ("incidentId", "clientName");
ALTER TABLE "StatusPageEvent" ADD CONSTRAINT "StatusPageEvent_providerId_externalId_key" UNIQUE ("providerId", "externalId");
ALTER TABLE "ProjectTag" ADD CONSTRAINT "ProjectTag_projectId_tag_key" UNIQUE ("projectId", "tag");
ALTER TABLE "WalletTag" ADD CONSTRAINT "WalletTag_walletId_tag_key" UNIQUE ("walletId", "tag");
ALTER TABLE "CommsThread" ADD CONSTRAINT "CommsThread_slackChannelId_slackRootTs_key" UNIQUE ("slackChannelId", "slackRootTs");
ALTER TABLE "CommsMessage" ADD CONSTRAINT "CommsMessage_threadId_slackTs_key" UNIQUE ("threadId", "slackTs");

-- ============================================================
-- Part 5: Add foreign keys
-- ============================================================

ALTER TABLE "KnowledgeScore" ADD CONSTRAINT "KnowledgeScore_scoredById_fkey" FOREIGN KEY ("scoredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommsThread" ADD CONSTRAINT "CommsThread_slackChannelId_fkey" FOREIGN KEY ("slackChannelId") REFERENCES "SlackChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ThreadParticipant" ADD CONSTRAINT "ThreadParticipant_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommsThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThreadLinkedRecord" ADD CONSTRAINT "ThreadLinkedRecord_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommsThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommsMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScoreEvidence" ADD CONSTRAINT "ScoreEvidence_scoreId_fkey" FOREIGN KEY ("scoreId") REFERENCES "CategoryScore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectTag" ADD CONSTRAINT "ProjectTag_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletTag" ADD CONSTRAINT "WalletTag_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "StakingWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientContactPreference" ADD CONSTRAINT "ClientContactPreference_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowEvent" ADD CONSTRAINT "WorkflowEvent_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClientServiceDependency" ADD CONSTRAINT "ClientServiceDependency_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientImpactRecord" ADD CONSTRAINT "ClientImpactRecord_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StatusPageEvent" ADD CONSTRAINT "StatusPageEvent_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorReliabilityScore" ADD CONSTRAINT "VendorReliabilityScore_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Part 6: Add indexes
-- ============================================================

-- Indexes for new columns on existing tables
CREATE INDEX "CommsThread_aiUrgencyScore_idx" ON "CommsThread"("aiUrgencyScore");
CREATE INDEX "Alert_severity_status_idx" ON "Alert"("severity", "status");

-- Indexes for new tables
CREATE INDEX "ThreadParticipant_threadId_idx" ON "ThreadParticipant"("threadId");
CREATE INDEX "ThreadLinkedRecord_threadId_idx" ON "ThreadLinkedRecord"("threadId");
CREATE INDEX "MessageAttachment_messageId_idx" ON "MessageAttachment"("messageId");
CREATE INDEX "ScoreEvidence_scoreId_idx" ON "ScoreEvidence"("scoreId");
CREATE INDEX "ProjectTag_projectId_idx" ON "ProjectTag"("projectId");
CREATE INDEX "WalletTag_walletId_idx" ON "WalletTag"("walletId");
CREATE INDEX "ClientContactPreference_clientName_idx" ON "ClientContactPreference"("clientName");
CREATE INDEX "ClientContactPreference_preferredChannel_idx" ON "ClientContactPreference"("preferredChannel");
CREATE INDEX "ClientContactPreference_active_idx" ON "ClientContactPreference"("active");
CREATE INDEX "WorkflowEvent_entityType_entityId_idx" ON "WorkflowEvent"("entityType", "entityId");
CREATE INDEX "WorkflowEvent_createdAt_idx" ON "WorkflowEvent"("createdAt");
CREATE INDEX "WorkflowEvent_entityType_entityId_createdAt_idx" ON "WorkflowEvent"("entityType", "entityId", "createdAt");
CREATE INDEX "WebhookEvent_source_status_idx" ON "WebhookEvent"("source", "status");
CREATE INDEX "WebhookEvent_createdAt_idx" ON "WebhookEvent"("createdAt");
-- SessionMetadata indexes already in migration 0013
CREATE INDEX "TransactionConfirmation_status_idx" ON "TransactionConfirmation"("status");
CREATE INDEX "TransactionConfirmation_riskLevel_idx" ON "TransactionConfirmation"("riskLevel");
CREATE INDEX "TransactionConfirmation_riskLevel_status_idx" ON "TransactionConfirmation"("riskLevel", "status");
CREATE INDEX "TransactionConfirmation_createdAt_idx" ON "TransactionConfirmation"("createdAt");
CREATE INDEX "TransactionConfirmation_expiresAt_idx" ON "TransactionConfirmation"("expiresAt");
CREATE INDEX "FeatureFlag_key_idx" ON "FeatureFlag"("key");
CREATE INDEX "FeatureFlag_enabled_idx" ON "FeatureFlag"("enabled");
CREATE INDEX "BackgroundJob_status_nextRunAt_idx" ON "BackgroundJob"("status", "nextRunAt");
CREATE INDEX "BackgroundJob_type_idx" ON "BackgroundJob"("type");
CREATE INDEX "BackgroundJob_isRecurring_status_idx" ON "BackgroundJob"("isRecurring", "status");
CREATE INDEX "BackgroundJob_deduplicationKey_idx" ON "BackgroundJob"("deduplicationKey");

-- ============================================================
-- Part 7: Convert TEXT columns to enum types
-- ============================================================

-- CommsThread
ALTER TABLE "CommsThread" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "CommsThread" ALTER COLUMN "priority" DROP DEFAULT;
ALTER TABLE "CommsThread" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "CommsThread" ALTER COLUMN "status" TYPE "ThreadStatus" USING "status"::"ThreadStatus";
ALTER TABLE "CommsThread" ALTER COLUMN "priority" TYPE "ThreadPriority" USING "priority"::"ThreadPriority";
ALTER TABLE "CommsThread" ALTER COLUMN "source" TYPE "CommsSource" USING "source"::"CommsSource";
ALTER TABLE "CommsThread" ALTER COLUMN "status" SET DEFAULT 'Unassigned'::"ThreadStatus";
ALTER TABLE "CommsThread" ALTER COLUMN "priority" SET DEFAULT 'P2'::"ThreadPriority";
ALTER TABLE "CommsThread" ALTER COLUMN "source" SET DEFAULT 'email'::"CommsSource";

-- Alert
ALTER TABLE "Alert" ALTER COLUMN "severity" DROP DEFAULT;
ALTER TABLE "Alert" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Alert" ALTER COLUMN "severity" TYPE "AlertSeverity" USING "severity"::"AlertSeverity";
ALTER TABLE "Alert" ALTER COLUMN "status" TYPE "AlertStatus" USING "status"::"AlertStatus";
ALTER TABLE "Alert" ALTER COLUMN "severity" SET DEFAULT 'medium'::"AlertSeverity";
ALTER TABLE "Alert" ALTER COLUMN "status" SET DEFAULT 'active'::"AlertStatus";

-- TravelRuleCase
ALTER TABLE "TravelRuleCase" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "TravelRuleCase" ALTER COLUMN "status" TYPE "TravelRuleCaseStatus" USING "status"::"TravelRuleCaseStatus";
ALTER TABLE "TravelRuleCase" ALTER COLUMN "resolutionType" TYPE "TravelRuleResolutionType" USING CASE WHEN "resolutionType" IS NOT NULL THEN "resolutionType"::"TravelRuleResolutionType" ELSE NULL END;
ALTER TABLE "TravelRuleCase" ALTER COLUMN "status" SET DEFAULT 'Open'::"TravelRuleCaseStatus";

-- Project
ALTER TABLE "Project" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Project" ALTER COLUMN "status" TYPE "ProjectStatus" USING "status"::"ProjectStatus";
ALTER TABLE "Project" ALTER COLUMN "status" SET DEFAULT 'active'::"ProjectStatus";

-- DailyCheckItem
ALTER TABLE "DailyCheckItem" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "DailyCheckItem" ALTER COLUMN "status" TYPE "DailyCheckStatus" USING "status"::"DailyCheckStatus";
ALTER TABLE "DailyCheckItem" ALTER COLUMN "status" SET DEFAULT 'pending'::"DailyCheckStatus";

-- Incident
ALTER TABLE "Incident" ALTER COLUMN "severity" DROP DEFAULT;
ALTER TABLE "Incident" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Incident" ALTER COLUMN "severity" TYPE "IncidentSeverity" USING "severity"::"IncidentSeverity";
ALTER TABLE "Incident" ALTER COLUMN "status" TYPE "IncidentStatus" USING "status"::"IncidentStatus";
ALTER TABLE "Incident" ALTER COLUMN "severity" SET DEFAULT 'medium'::"IncidentSeverity";
ALTER TABLE "Incident" ALTER COLUMN "status" SET DEFAULT 'active'::"IncidentStatus";

-- User
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole" USING "role"::"UserRole";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'employee'::"UserRole";

-- Employee
ALTER TABLE "Employee" ALTER COLUMN "region" DROP DEFAULT;
ALTER TABLE "Employee" ALTER COLUMN "role" TYPE "EmployeeRole" USING "role"::"EmployeeRole";
ALTER TABLE "Employee" ALTER COLUMN "team" TYPE "TeamName" USING "team"::"TeamName";
ALTER TABLE "Employee" ALTER COLUMN "region" TYPE "Region" USING "region"::"Region";
ALTER TABLE "Employee" ALTER COLUMN "region" SET DEFAULT 'Global'::"Region";

-- TimePeriod
ALTER TABLE "TimePeriod" ALTER COLUMN "type" TYPE "TimePeriodType" USING "type"::"TimePeriodType";

-- CategoryScore
ALTER TABLE "CategoryScore" ALTER COLUMN "category" TYPE "ScoreCategory" USING "category"::"ScoreCategory";
