-- Baseline schema (Phase 12l). Consolidates the earlier migration history into
-- one migration. Sections:
--   1. Tables, types, indexes and keys, generated from prisma/schema.prisma.
--   2. Database-enforced controls that Prisma cannot express:
--      - AuditLog is append-only and normalises its actor (userId "system" for
--        system entries; see src/lib/api/audit.ts);
--      - BackgroundJobRun is append-only inside its retention period;
--      - one open alert per (ruleCode, dedupeKey), one active ScoringConfig.
--   3. Reference data: the system actor, SLA policies (targets unset until
--      TODO(CONFIRM-SLA-TARGETS)), disabled alert rules, impact rules, incident
--      categories, Jira project registry (all disabled), settlement windows,
--      risk tiers, teams and UAT templates. Everything is inactive or disabled
--      until an administrator configures it.
-- Roles and grants are applied separately (docs/phase1/db-roles.sql).
-- The whole file runs in one transaction, so a failed run leaves nothing
-- behind and start.sh can mark it rolled back and retry.

BEGIN;

-- 1. Schema
-- CreateEnum
CREATE TYPE "ThreadStatus" AS ENUM ('Unassigned', 'Assigned', 'InProgress', 'WaitingExternal', 'WaitingInternal', 'PendingHandover', 'Done', 'Closed');

-- CreateEnum
CREATE TYPE "ThreadPriority" AS ENUM ('P0', 'P1', 'P2', 'P3');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('active', 'acknowledged', 'resolved');

-- CreateEnum
CREATE TYPE "TravelRuleCaseStatus" AS ENUM ('Open', 'Investigating', 'PendingResponse', 'Resolved', 'Escalated');

-- CreateEnum
CREATE TYPE "TravelRuleResolutionType" AS ENUM ('info_obtained', 'email_sent', 'not_required', 'escalated');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('planned', 'active', 'on_hold', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "DailyCheckStatus" AS ENUM ('pending', 'pass', 'issues_found', 'skipped');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('active', 'monitoring', 'resolved');

-- CreateEnum
CREATE TYPE "CommsSource" AS ENUM ('email', 'slack', 'jira', 'manual');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'lead', 'employee', 'auditor');

-- CreateEnum
CREATE TYPE "ScoringConfigStatus" AS ENUM ('draft', 'review', 'approved', 'active', 'archived');

-- CreateEnum
CREATE TYPE "EmployeeRole" AS ENUM ('Analyst', 'Senior', 'Lead', 'Manager');

-- CreateEnum
CREATE TYPE "TeamName" AS ENUM ('TransactionOperations', 'AdminOperations', 'DataOperations', 'StakingOps', 'Settlements');

-- CreateEnum
CREATE TYPE "Region" AS ENUM ('Global', 'EMEA', 'APAC', 'Americas');

-- CreateEnum
CREATE TYPE "TimePeriodType" AS ENUM ('week', 'month', 'quarter');

-- CreateEnum
CREATE TYPE "ScoreCategory" AS ENUM ('daily_tasks', 'projects', 'asset_actions', 'quality', 'knowledge');

-- CreateEnum
CREATE TYPE "TransactionRiskLevel" AS ENUM ('low', 'medium', 'high', 'critical', 'unknown');

-- CreateEnum
CREATE TYPE "ConfirmationStatus" AS ENUM ('pending', 'owned', 'closed_in_source', 'escalated', 'expired');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'retrying');

-- CreateEnum
CREATE TYPE "WorkItemKind" AS ENUM ('client_request', 'client_incident', 'client_risk', 'alert', 'daily_check_exception', 'mtd_break', 'oes_settlement', 'bank_instruction', 'realisation_case', 'vendor_ticket', 'travel_rule_case', 'screening_case', 'scam_dust_case', 'coin_review', 'staking_exception', 'nft_review', 'report_task', 'incident', 'rca', 'internal_task', 'uat_task');

-- CreateEnum
CREATE TYPE "WorkItemState" AS ENUM ('open', 'owned', 'waiting_client', 'waiting_vendor', 'waiting_internal', 'resolved', 'closed');

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "EmployeeRole" NOT NULL,
    "team" "TeamName" NOT NULL,
    "region" "Region" NOT NULL DEFAULT 'Global',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'employee',
    "password" TEXT NOT NULL,
    "employeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimePeriod" (
    "id" TEXT NOT NULL,
    "type" "TimePeriodType" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryScore" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "category" "ScoreCategory" NOT NULL,
    "rawIndex" DOUBLE PRECISION NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "configVersion" TEXT NOT NULL,
    "evidence" TEXT NOT NULL DEFAULT '[]',
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeScore" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "operationalUnderstanding" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assetKnowledge" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "complianceAwareness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "incidentResponse" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overallRaw" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mappedScore" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "notes" TEXT NOT NULL DEFAULT '',
    "scoredBy" TEXT NOT NULL DEFAULT '',
    "scoredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoringConfig" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "status" "ScoringConfigStatus" NOT NULL DEFAULT 'draft',
    "createdById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ScoringConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeNote" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "noteType" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommsThread" (
    "id" TEXT NOT NULL,
    "source" "CommsSource" NOT NULL DEFAULT 'email',
    "sourceThreadRef" TEXT NOT NULL,
    "participants" TEXT NOT NULL DEFAULT '[]',
    "clientOrPartnerTag" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL,
    "priority" "ThreadPriority" NOT NULL DEFAULT 'P2',
    "status" "ThreadStatus" NOT NULL DEFAULT 'Unassigned',
    "ownerUserId" TEXT,
    "secondaryOwnerIds" TEXT NOT NULL DEFAULT '[]',
    "queue" TEXT NOT NULL DEFAULT 'Transaction Operations',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActionAt" TIMESTAMP(3),
    "ttoDeadline" TIMESTAMP(3),
    "ttfaDeadline" TIMESTAMP(3),
    "tslaDeadline" TIMESTAMP(3),
    "linkedRecords" TEXT NOT NULL DEFAULT '[]',
    "slackChannelId" TEXT,
    "slackRootTs" TEXT,
    "slackThreadTs" TEXT,
    "isSlackThread" BOOLEAN NOT NULL DEFAULT false,
    "slackReplyCount" INTEGER,
    "slackLastReplyTs" TEXT,
    "aiClassification" JSONB,
    "aiClassifiedAt" TIMESTAMP(3),
    "aiUrgencyScore" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CommsThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommsMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorName" TEXT NOT NULL,
    "authorEmail" TEXT NOT NULL DEFAULT '',
    "authorType" TEXT NOT NULL,
    "bodySnippet" TEXT NOT NULL,
    "bodyLink" TEXT NOT NULL DEFAULT '',
    "attachments" TEXT NOT NULL DEFAULT '[]',
    "slackTs" TEXT,
    "slackUserId" TEXT,
    "slackThreadTs" TEXT,
    "isRootMessage" BOOLEAN NOT NULL DEFAULT false,
    "slackReactions" JSONB,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "CommsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnershipChange" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "oldOwnerId" TEXT,
    "newOwnerId" TEXT,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL DEFAULT '',
    "handoverNote" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "OwnershipChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThreadNote" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThreadNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThreadParticipant" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL,

    CONSTRAINT "ThreadParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThreadLinkedRecord" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ThreadLinkedRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "mimeType" TEXT NOT NULL DEFAULT '',
    "storageRef" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "ProjectTag" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "ProjectTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTag" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "WalletTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelRuleCase" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL DEFAULT '',
    "direction" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "senderAddress" TEXT NOT NULL DEFAULT '',
    "receiverAddress" TEXT NOT NULL DEFAULT '',
    "matchStatus" TEXT NOT NULL,
    "notabeneTransferId" TEXT,
    "ownerUserId" TEXT,
    "status" "TravelRuleCaseStatus" NOT NULL DEFAULT 'Open',
    "resolutionType" "TravelRuleResolutionType",
    "resolutionNote" TEXT NOT NULL DEFAULT '',
    "emailSentTo" TEXT,
    "emailSentAt" TIMESTAMP(3),
    "slaDeadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "TravelRuleCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "CaseNote" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnCallSchedule" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "team" TEXT NOT NULL,
    "shiftType" TEXT NOT NULL DEFAULT 'primary',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnCallSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicHoliday" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'Global',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtoRecord" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'annual_leave',
    "status" TEXT NOT NULL DEFAULT 'approved',
    "notes" TEXT NOT NULL DEFAULT '',
    "hibobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtoRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyTask" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "team" TEXT NOT NULL,
    "assigneeId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "category" TEXT NOT NULL DEFAULT 'operational',
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "team" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'active',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "startDate" TIMESTAMP(3),
    "targetDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "progress" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'contributor',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectUpdate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'progress',
    "progress" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectUpdate_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "threadId" TEXT,
    "employeeId" TEXT,
    "travelRuleCaseId" TEXT,
    "incidentId" TEXT,
    "type" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'medium',
    "priority" TEXT NOT NULL DEFAULT 'P2',
    "message" TEXT NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'active',
    "destination" TEXT NOT NULL DEFAULT 'in_app',
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ruleCode" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "workItemId" TEXT,
    "firstFiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fireCount" INTEGER NOT NULL DEFAULT 1,
    "escalatedAt" TIMESTAMP(3),
    "autoResolvedAt" TIMESTAMP(3),
    "detail" TEXT NOT NULL DEFAULT '',
    "exposureUsd" DECIMAL(20,2),
    "cleanRuns" INTEGER NOT NULL DEFAULT 0,
    "lastNotifiedAt" TIMESTAMP(3),
    "escalationStep" INTEGER NOT NULL DEFAULT 0,
    "digestedAt" TIMESTAMP(3),

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT,
    "title" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'medium',
    "status" "IncidentStatus" NOT NULL DEFAULT 'active',
    "description" TEXT NOT NULL DEFAULT '',
    "impact" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "reportedById" TEXT NOT NULL,
    "resolvedById" TEXT,
    "linkedThreadIds" TEXT NOT NULL DEFAULT '[]',
    "linkedTransactionIds" TEXT NOT NULL DEFAULT '[]',
    "rcaStatus" TEXT NOT NULL DEFAULT 'none',
    "rcaDocumentRef" TEXT NOT NULL DEFAULT '',
    "rcaResponsibleId" TEXT,
    "rcaSlaDeadline" TIMESTAMP(3),
    "rcaReceivedAt" TIMESTAMP(3),
    "rcaFollowUpItems" TEXT NOT NULL DEFAULT '[]',
    "rcaRaisedAt" TIMESTAMP(3),
    "externalTicketRef" TEXT NOT NULL DEFAULT '',
    "externalTicketUrl" TEXT NOT NULL DEFAULT '',
    "externalTicketStatus" TEXT NOT NULL DEFAULT '',
    "externalTicketLastSyncAt" TIMESTAMP(3),
    "externalTicketDisputed" BOOLEAN NOT NULL DEFAULT false,
    "externalTicketDisputeReason" TEXT NOT NULL DEFAULT '',
    "affectedServices" JSONB NOT NULL DEFAULT '[]',
    "detectionSource" TEXT NOT NULL DEFAULT 'manual',
    "clientImpactCount" INTEGER NOT NULL DEFAULT 0,
    "clientNotifiedCount" INTEGER NOT NULL DEFAULT 0,
    "firstClientNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentUpdate" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'update',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalTicketEvent" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL DEFAULT '',
    "toStatus" TEXT NOT NULL DEFAULT '',
    "performedBy" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "jiraComment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalTicketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OesSettlement" (
    "id" TEXT NOT NULL,
    "settlementRef" TEXT NOT NULL,
    "venue" TEXT NOT NULL DEFAULT 'exchange',
    "clientName" TEXT NOT NULL,
    "clientAccount" TEXT NOT NULL DEFAULT '',
    "asset" TEXT NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "direction" TEXT NOT NULL,
    "settlementCycle" TEXT NOT NULL DEFAULT '',
    "exchangeInstructionId" TEXT NOT NULL DEFAULT '',
    "onChainTxHash" TEXT NOT NULL DEFAULT '',
    "collateralWallet" TEXT NOT NULL DEFAULT '',
    "custodyWallet" TEXT NOT NULL DEFAULT '',
    "matchStatus" TEXT NOT NULL DEFAULT 'pending',
    "matchNote" TEXT NOT NULL DEFAULT '',
    "delegationStatus" TEXT NOT NULL DEFAULT 'n/a',
    "delegatedAmount" DECIMAL(38,18) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "makerById" TEXT,
    "makerAt" TIMESTAMP(3),
    "checkerById" TEXT,
    "checkerAt" TIMESTAMP(3),
    "escalationNote" TEXT NOT NULL DEFAULT '',
    "fireblockssTxId" TEXT NOT NULL DEFAULT '',
    "oesSignerGroup" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OesSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsdcRampRequest" (
    "id" TEXT NOT NULL,
    "ticketRef" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientAccount" TEXT NOT NULL DEFAULT '',
    "direction" TEXT NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "fiatCurrency" TEXT NOT NULL DEFAULT 'USD',
    "fiatAmount" DECIMAL(20,2),
    "status" TEXT NOT NULL DEFAULT 'instruction_received',
    "bankReference" TEXT NOT NULL DEFAULT '',
    "instructionRef" TEXT NOT NULL DEFAULT '',
    "ssiVerified" BOOLEAN NOT NULL DEFAULT false,
    "ssiDetails" TEXT NOT NULL DEFAULT '',
    "custodyWalletId" TEXT NOT NULL DEFAULT '',
    "holdingWalletId" TEXT NOT NULL DEFAULT '',
    "onChainTxHash" TEXT NOT NULL DEFAULT '',
    "gasWalletOk" BOOLEAN NOT NULL DEFAULT true,
    "issuerConfirmation" TEXT NOT NULL DEFAULT '',
    "expressEnabled" BOOLEAN NOT NULL DEFAULT true,
    "feesFromBuffer" BOOLEAN NOT NULL DEFAULT true,
    "feeBufferLow" BOOLEAN NOT NULL DEFAULT false,
    "makerById" TEXT,
    "makerAt" TIMESTAMP(3),
    "makerNote" TEXT NOT NULL DEFAULT '',
    "checkerById" TEXT,
    "checkerAt" TIMESTAMP(3),
    "checkerNote" TEXT NOT NULL DEFAULT '',
    "kycAmlOk" BOOLEAN NOT NULL DEFAULT false,
    "walletWhitelisted" BOOLEAN NOT NULL DEFAULT false,
    "evidence" TEXT NOT NULL DEFAULT '[]',
    "notes" TEXT NOT NULL DEFAULT '',
    "rejectionReason" TEXT NOT NULL DEFAULT '',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "clientNotifiedAt" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsdcRampRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandingConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "appName" TEXT NOT NULL DEFAULT 'KOMmand Centre',
    "subtitle" TEXT NOT NULL DEFAULT 'Ops Management & Comms Hub',
    "logoData" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '{}',
    "actorType" TEXT NOT NULL DEFAULT 'user',
    "actorUserId" TEXT,
    "correlationId" TEXT,
    "phase" TEXT NOT NULL DEFAULT 'recorded',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StakingWallet" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "validator" TEXT NOT NULL DEFAULT '',
    "stakedAmount" DECIMAL(38,18) NOT NULL DEFAULT 0,
    "rewardModel" TEXT NOT NULL,
    "clientName" TEXT NOT NULL DEFAULT '',
    "isColdStaking" BOOLEAN NOT NULL DEFAULT false,
    "isTestWallet" BOOLEAN NOT NULL DEFAULT false,
    "stakeDate" TIMESTAMP(3),
    "expectedFirstRewardDate" TIMESTAMP(3),
    "actualFirstRewardDate" TIMESTAMP(3),
    "lastRewardAt" TIMESTAMP(3),
    "expectedNextRewardAt" TIMESTAMP(3),
    "onChainBalance" DECIMAL(38,18),
    "platformBalance" DECIMAL(38,18),
    "varianceThreshold" DECIMAL(38,18) NOT NULL DEFAULT 0.01,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "notes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StakingWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyCheckRun" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "operatorId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "jiraSummary" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyCheckRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyCheckItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" "DailyCheckStatus" NOT NULL DEFAULT 'pending',
    "autoCheckKey" TEXT NOT NULL DEFAULT '',
    "autoResult" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "operatorId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "definitionCode" TEXT,
    "periodKey" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "recordCount" INTEGER,
    "dataAsOf" TIMESTAMP(3),
    "skippedReason" TEXT,
    "skipRequestedBy" TEXT,
    "skipApprovedBy" TEXT,
    "exceptionWorkItemIds" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "DailyCheckItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyCheckDefinition" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "dueByLocal" TEXT NOT NULL,
    "evidenceSpec" JSONB NOT NULL,
    "ticketProject" TEXT NOT NULL,
    "confluenceUrl" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'check',
    "requiredFlag" TEXT,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyCheckDefinition_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ScreeningEntry" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL DEFAULT '',
    "asset" TEXT NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL DEFAULT 0,
    "direction" TEXT NOT NULL DEFAULT 'IN',
    "screeningStatus" TEXT NOT NULL DEFAULT 'not_submitted',
    "classification" TEXT NOT NULL DEFAULT 'unclassified',
    "isKnownException" BOOLEAN NOT NULL DEFAULT false,
    "exceptionReason" TEXT NOT NULL DEFAULT '',
    "analyticsAlertId" TEXT NOT NULL DEFAULT '',
    "analyticsStatus" TEXT NOT NULL DEFAULT 'none',
    "complianceReviewStatus" TEXT NOT NULL DEFAULT 'none',
    "reclassifiedAt" TIMESTAMP(3),
    "reclassifiedById" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreeningEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenReview" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "network" TEXT NOT NULL DEFAULT '',
    "contractAddress" TEXT NOT NULL DEFAULT '',
    "tokenType" TEXT NOT NULL DEFAULT 'native',
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "proposedById" TEXT,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "complianceById" TEXT,
    "complianceAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "liveAt" TIMESTAMP(3),
    "rejectionReason" TEXT NOT NULL DEFAULT '',
    "riskLevel" TEXT NOT NULL DEFAULT 'medium',
    "riskNotes" TEXT NOT NULL DEFAULT '',
    "regulatoryNotes" TEXT NOT NULL DEFAULT '',
    "sanctionsCheck" BOOLEAN NOT NULL DEFAULT false,
    "amlRiskAssessed" BOOLEAN NOT NULL DEFAULT false,
    "custodianSupport" TEXT NOT NULL DEFAULT '[]',
    "stakingAvailable" BOOLEAN NOT NULL DEFAULT false,
    "chainalysisSupport" TEXT NOT NULL DEFAULT 'unknown',
    "notabeneSupport" TEXT NOT NULL DEFAULT 'unknown',
    "fireblocksSupport" TEXT NOT NULL DEFAULT 'unknown',
    "ledgerSupport" TEXT NOT NULL DEFAULT 'unknown',
    "vendorNotes" TEXT NOT NULL DEFAULT '',
    "demandScore" INTEGER NOT NULL DEFAULT 0,
    "aiResearchResult" TEXT NOT NULL DEFAULT '',
    "aiResearchedAt" TIMESTAMP(3),
    "aiRecommendation" TEXT NOT NULL DEFAULT '',
    "jiraTicket" TEXT NOT NULL DEFAULT '',
    "complianceDoc" TEXT NOT NULL DEFAULT '',
    "launchDate" TEXT NOT NULL DEFAULT '',
    "founders" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "supportedNetworks" TEXT NOT NULL DEFAULT '',
    "whitepaper" TEXT NOT NULL DEFAULT '',
    "explorer" TEXT NOT NULL DEFAULT '',
    "blockchainAnalytics" TEXT NOT NULL DEFAULT 'unknown',
    "travelRuleNotabene" BOOLEAN NOT NULL DEFAULT false,
    "priceFeedCoingecko" BOOLEAN NOT NULL DEFAULT false,
    "consensusMechanism" TEXT NOT NULL DEFAULT '',
    "privacyToken" BOOLEAN NOT NULL DEFAULT false,
    "smartContractReview" BOOLEAN NOT NULL DEFAULT false,
    "smartContractReviewNotes" TEXT NOT NULL DEFAULT '',
    "jurisdictionStatus" TEXT NOT NULL DEFAULT '',
    "marketCapTier" TEXT NOT NULL DEFAULT 'unknown',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenDemandSignal" (
    "id" TEXT NOT NULL,
    "tokenReviewId" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "weight" INTEGER NOT NULL DEFAULT 1,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenDemandSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "SessionMetadata" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionConfirmation" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "requestId" TEXT,
    "riskLevel" "TransactionRiskLevel" NOT NULL DEFAULT 'unknown',
    "asset" TEXT NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "direction" TEXT NOT NULL,
    "account" TEXT NOT NULL DEFAULT '',
    "workspace" TEXT NOT NULL DEFAULT '',
    "status" "ConfirmationStatus" NOT NULL DEFAULT 'pending',
    "ownedById" TEXT,
    "ownedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedInSourceAt" TIMESTAMP(3),
    "ticketRef" TEXT NOT NULL DEFAULT '',
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "BackgroundJobRun" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "error" TEXT NOT NULL DEFAULT '',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackgroundJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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
    "clientId" TEXT,
    "purpose" TEXT NOT NULL DEFAULT 'internal_ops',

    CONSTRAINT "SlackChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "custodyOrgId" TEXT,
    "custodyAccountNos" JSONB NOT NULL DEFAULT '[]',
    "jsmOrganizationId" TEXT,
    "jurisdiction" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "inboundThresholdUsd" DECIMAL(20,2),
    "thresholdReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserClientScope" (
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,

    CONSTRAINT "UserClientScope_pkey" PRIMARY KEY ("userId","clientId")
);

-- CreateTable
CREATE TABLE "ClientChannel" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItem" (
    "id" TEXT NOT NULL,
    "kind" "WorkItemKind" NOT NULL,
    "title" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "taskCode" TEXT NOT NULL,
    "clientId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'P2',
    "riskScore" TEXT,
    "state" "WorkItemState" NOT NULL DEFAULT 'open',
    "ownerEmployeeId" TEXT,
    "sourceSystem" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ticketSystem" TEXT,
    "ticketKey" TEXT,
    "ticketUrl" TEXT,
    "slaPolicyId" TEXT,
    "clockStartedAt" TIMESTAMP(3) NOT NULL,
    "firstResponseAt" TIMESTAMP(3),
    "ownedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "rootCause" TEXT,
    "exposureUsd" DECIMAL(20,2),
    "clientTicketKey" TEXT,
    "clientTicketUrl" TEXT,
    "sourceMessageRef" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaPolicy" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ownershipMins" INTEGER,
    "firstRespMins" INTEGER,
    "resolveMins" INTEGER,
    "resolveRule" TEXT,
    "calendar" TEXT NOT NULL DEFAULT '24x7',
    "warnAtPct" INTEGER NOT NULL DEFAULT 50,
    "breachEscalationRole" TEXT NOT NULL DEFAULT 'lead',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaEvent" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlaEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "code" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "severity" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "route" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastEvaluatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "SourceHeartbeat" (
    "source" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastRecordAt" TIMESTAMP(3),
    "lastCount" INTEGER NOT NULL DEFAULT 0,
    "expectedEveryMins" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceHeartbeat_pkey" PRIMARY KEY ("source")
);

-- CreateTable
CREATE TABLE "TimeLog" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "clientId" TEXT,
    "bucketMins" INTEGER NOT NULL,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loggedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketLink" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'primary',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentLogDraft" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "triggerCode" TEXT NOT NULL,
    "jiraKey" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentLogDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceRecord" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "credentialLabel" TEXT NOT NULL DEFAULT '',
    "status" TEXT,
    "mappedStatus" TEXT,
    "occurredAt" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3),
    "fields" JSONB NOT NULL DEFAULT '{}',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementStatusMap" (
    "entity" TEXT NOT NULL,
    "raw" TEXT NOT NULL,
    "mapped" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementStatusMap_pkey" PRIMARY KEY ("entity","raw")
);

-- CreateTable
CREATE TABLE "JiraProjectConfig" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'jira',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "syncInbound" BOOLEAN NOT NULL DEFAULT true,
    "defaultWorkItemKind" TEXT NOT NULL DEFAULT 'internal_task',
    "defaultTeam" TEXT NOT NULL DEFAULT 'All',
    "defaultTaskCode" TEXT NOT NULL DEFAULT '',
    "serviceDeskId" TEXT,
    "issueTypeIds" JSONB NOT NULL DEFAULT '{}',
    "allowedCustomFields" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JiraProjectConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "JiraIssueEvent" (
    "id" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "updated" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "assignee" TEXT,
    "workItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JiraIssueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "OesWindow" (
    "id" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "durationMins" INTEGER NOT NULL,
    "referenceTz" TEXT NOT NULL DEFAULT 'UTC',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OesWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetThreshold" (
    "asset" TEXT NOT NULL,
    "stuckMins" INTEGER NOT NULL DEFAULT 120,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetThreshold_pkey" PRIMARY KEY ("asset")
);

-- CreateTable
CREATE TABLE "RiskRuleTier" (
    "rule" INTEGER NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'high',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskRuleTier_pkey" PRIMARY KEY ("rule")
);

-- CreateTable
CREATE TABLE "TeamConfig" (
    "team" TEXT NOT NULL,
    "leadEmployeeId" TEXT,
    "deputyEmployeeId" TEXT,
    "memberEmployeeIds" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamConfig_pkey" PRIMARY KEY ("team")
);

-- CreateTable
CREATE TABLE "AssetStatus" (
    "asset" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'normal',
    "reason" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetStatus_pkey" PRIMARY KEY ("asset")
);

-- CreateTable
CREATE TABLE "ApprovedValidator" (
    "id" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "validator" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovedValidator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementNote" (
    "id" TEXT NOT NULL,
    "windowKey" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankInstruction" (
    "id" TEXT NOT NULL,
    "messageType" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "instructionType" TEXT NOT NULL DEFAULT '',
    "direction" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
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

    CONSTRAINT "BankInstruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankSettlementLog" (
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

    CONSTRAINT "BankSettlementLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankFeeBalance" (
    "id" TEXT NOT NULL,
    "walletRef" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "balance" DECIMAL(38,18) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT,

    CONSTRAINT "BankFeeBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtcBreakType" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtcBreakType_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "UserNotificationPreference" (
    "userId" TEXT NOT NULL,
    "onAssignProjects" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "InAppNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InAppNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncCursor" (
    "source" TEXT NOT NULL,
    "cursor" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncCursor_pkey" PRIMARY KEY ("source")
);

-- CreateTable
CREATE TABLE "PollCycle" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "PollCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentCategory" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "complianceSensitive" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentCategory_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ClientUpdate" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'update',
    "targetStatus" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_approval',
    "authorId" TEXT NOT NULL,
    "approverId" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundMessageDraft" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "target" JSONB NOT NULL,
    "body" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'client_ticket_link',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundMessageDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "PlatformSprint" (
    "id" TEXT NOT NULL,
    "sprint" TEXT NOT NULL,
    "releaseNotesUrl" TEXT NOT NULL DEFAULT '',
    "releaseNotesPageId" TEXT,
    "pageVersion" INTEGER NOT NULL DEFAULT 0,
    "uatLandedAt" TIMESTAMP(3),
    "prodPlannedAt" TIMESTAMP(3),
    "changeKeys" JSONB NOT NULL DEFAULT '[]',
    "fixVersions" JSONB NOT NULL DEFAULT '[]',
    "parentTicketKey" TEXT,
    "parentWorkItemId" TEXT,
    "lastParsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformChange" (
    "id" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "platformJiraKeys" JSONB NOT NULL DEFAULT '[]',
    "env" TEXT NOT NULL DEFAULT '',
    "rowHash" TEXT NOT NULL,
    "firstCell" TEXT NOT NULL DEFAULT '',
    "qualifies" BOOLEAN NOT NULL DEFAULT false,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "team" TEXT NOT NULL DEFAULT 'All',
    "priority" TEXT NOT NULL DEFAULT 'P2',
    "uatTemplate" TEXT,
    "affectedTasks" JSONB NOT NULL DEFAULT '[]',
    "affectedAlerts" JSONB NOT NULL DEFAULT '[]',
    "affectedControls" JSONB NOT NULL DEFAULT '[]',
    "predecessorId" TEXT,
    "workItemId" TEXT,
    "uatTicketKey" TEXT,
    "uatOutcome" TEXT,
    "pageVersion" INTEGER NOT NULL DEFAULT 0,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformImpactRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "matchOn" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "taskCodes" JSONB NOT NULL DEFAULT '[]',
    "alertCodes" JSONB NOT NULL DEFAULT '[]',
    "controls" JSONB NOT NULL DEFAULT '[]',
    "team" TEXT NOT NULL DEFAULT 'All',
    "uatTemplate" TEXT NOT NULL DEFAULT '',
    "priority" TEXT NOT NULL DEFAULT 'P2',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformImpactRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UatTemplate" (
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "steps" TEXT NOT NULL DEFAULT '',
    "expectedResults" TEXT NOT NULL DEFAULT '',
    "evidenceRequired" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UatTemplate_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "_archived_approval_audit_entry" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "performedById" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL DEFAULT 'medium',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "_archived_approval_audit_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");

-- CreateIndex
CREATE INDEX "Employee_team_active_idx" ON "Employee"("team", "active");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "TimePeriod_type_startDate_key" ON "TimePeriod"("type", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryScore_employeeId_periodId_category_key" ON "CategoryScore"("employeeId", "periodId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeScore_employeeId_periodId_key" ON "KnowledgeScore"("employeeId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "ScoringConfig_version_key" ON "ScoringConfig"("version");

-- CreateIndex
CREATE INDEX "ScoringConfig_status_idx" ON "ScoringConfig"("status");

-- CreateIndex
CREATE INDEX "ScoringConfig_active_idx" ON "ScoringConfig"("active");

-- CreateIndex
CREATE INDEX "EmployeeNote_employeeId_idx" ON "EmployeeNote"("employeeId");

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
CREATE INDEX "CommsThread_aiUrgencyScore_idx" ON "CommsThread"("aiUrgencyScore");

-- CreateIndex
CREATE UNIQUE INDEX "CommsThread_slackChannelId_slackRootTs_key" ON "CommsThread"("slackChannelId", "slackRootTs");

-- CreateIndex
CREATE INDEX "CommsMessage_threadId_idx" ON "CommsMessage"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "CommsMessage_threadId_slackTs_key" ON "CommsMessage"("threadId", "slackTs");

-- CreateIndex
CREATE INDEX "OwnershipChange_threadId_idx" ON "OwnershipChange"("threadId");

-- CreateIndex
CREATE INDEX "OwnershipChange_changedAt_idx" ON "OwnershipChange"("changedAt");

-- CreateIndex
CREATE INDEX "ThreadNote_threadId_idx" ON "ThreadNote"("threadId");

-- CreateIndex
CREATE INDEX "ThreadParticipant_threadId_idx" ON "ThreadParticipant"("threadId");

-- CreateIndex
CREATE INDEX "ThreadLinkedRecord_threadId_idx" ON "ThreadLinkedRecord"("threadId");

-- CreateIndex
CREATE INDEX "MessageAttachment_messageId_idx" ON "MessageAttachment"("messageId");

-- CreateIndex
CREATE INDEX "ScoreEvidence_scoreId_idx" ON "ScoreEvidence"("scoreId");

-- CreateIndex
CREATE INDEX "ProjectTag_projectId_idx" ON "ProjectTag"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTag_projectId_tag_key" ON "ProjectTag"("projectId", "tag");

-- CreateIndex
CREATE INDEX "WalletTag_walletId_idx" ON "WalletTag"("walletId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTag_walletId_tag_key" ON "WalletTag"("walletId", "tag");

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
CREATE UNIQUE INDEX "TravelRuleCase_transactionId_matchStatus_key" ON "TravelRuleCase"("transactionId", "matchStatus");

-- CreateIndex
CREATE UNIQUE INDEX "VaspContact_vaspDid_key" ON "VaspContact"("vaspDid");

-- CreateIndex
CREATE UNIQUE INDEX "ClientContactPreference_clientName_key" ON "ClientContactPreference"("clientName");

-- CreateIndex
CREATE INDEX "ClientContactPreference_clientName_idx" ON "ClientContactPreference"("clientName");

-- CreateIndex
CREATE INDEX "ClientContactPreference_preferredChannel_idx" ON "ClientContactPreference"("preferredChannel");

-- CreateIndex
CREATE INDEX "ClientContactPreference_active_idx" ON "ClientContactPreference"("active");

-- CreateIndex
CREATE INDEX "CaseNote_caseId_idx" ON "CaseNote"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "OnCallSchedule_date_team_shiftType_key" ON "OnCallSchedule"("date", "team", "shiftType");

-- CreateIndex
CREATE UNIQUE INDEX "PublicHoliday_date_region_key" ON "PublicHoliday"("date", "region");

-- CreateIndex
CREATE UNIQUE INDEX "RotaAssignment_subTeamId_employeeId_startDate_key" ON "RotaAssignment"("subTeamId", "employeeId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_employeeId_key" ON "ProjectMember"("projectId", "employeeId");

-- CreateIndex
CREATE INDEX "ActivityStatus_employeeId_startedAt_idx" ON "ActivityStatus"("employeeId", "startedAt");

-- CreateIndex
CREATE INDEX "ActivityStatus_endedAt_idx" ON "ActivityStatus"("endedAt");

-- CreateIndex
CREATE INDEX "Alert_threadId_idx" ON "Alert"("threadId");

-- CreateIndex
CREATE INDEX "Alert_employeeId_idx" ON "Alert"("employeeId");

-- CreateIndex
CREATE INDEX "Alert_travelRuleCaseId_idx" ON "Alert"("travelRuleCaseId");

-- CreateIndex
CREATE INDEX "Alert_incidentId_idx" ON "Alert"("incidentId");

-- CreateIndex
CREATE INDEX "Alert_workItemId_idx" ON "Alert"("workItemId");

-- CreateIndex
CREATE INDEX "Alert_status_idx" ON "Alert"("status");

-- CreateIndex
CREATE INDEX "Alert_type_idx" ON "Alert"("type");

-- CreateIndex
CREATE INDEX "Alert_type_status_idx" ON "Alert"("type", "status");

-- CreateIndex
CREATE INDEX "Alert_severity_status_idx" ON "Alert"("severity", "status");

-- CreateIndex
CREATE INDEX "Alert_ruleCode_dedupeKey_status_idx" ON "Alert"("ruleCode", "dedupeKey", "status");

-- CreateIndex
CREATE INDEX "Incident_status_idx" ON "Incident"("status");

-- CreateIndex
CREATE INDEX "Incident_provider_idx" ON "Incident"("provider");

-- CreateIndex
CREATE INDEX "Incident_rcaStatus_idx" ON "Incident"("rcaStatus");

-- CreateIndex
CREATE INDEX "Incident_externalTicketRef_idx" ON "Incident"("externalTicketRef");

-- CreateIndex
CREATE INDEX "Incident_severity_status_idx" ON "Incident"("severity", "status");

-- CreateIndex
CREATE INDEX "IncidentUpdate_incidentId_idx" ON "IncidentUpdate"("incidentId");

-- CreateIndex
CREATE INDEX "ExternalTicketEvent_incidentId_idx" ON "ExternalTicketEvent"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "OesSettlement_settlementRef_key" ON "OesSettlement"("settlementRef");

-- CreateIndex
CREATE INDEX "OesSettlement_status_idx" ON "OesSettlement"("status");

-- CreateIndex
CREATE INDEX "OesSettlement_matchStatus_idx" ON "OesSettlement"("matchStatus");

-- CreateIndex
CREATE INDEX "OesSettlement_clientName_idx" ON "OesSettlement"("clientName");

-- CreateIndex
CREATE INDEX "OesSettlement_venue_idx" ON "OesSettlement"("venue");

-- CreateIndex
CREATE INDEX "OesSettlement_settlementCycle_idx" ON "OesSettlement"("settlementCycle");

-- CreateIndex
CREATE UNIQUE INDEX "UsdcRampRequest_ticketRef_key" ON "UsdcRampRequest"("ticketRef");

-- CreateIndex
CREATE INDEX "UsdcRampRequest_status_idx" ON "UsdcRampRequest"("status");

-- CreateIndex
CREATE INDEX "UsdcRampRequest_clientName_idx" ON "UsdcRampRequest"("clientName");

-- CreateIndex
CREATE INDEX "UsdcRampRequest_direction_idx" ON "UsdcRampRequest"("direction");

-- CreateIndex
CREATE INDEX "UsdcRampRequest_ticketRef_idx" ON "UsdcRampRequest"("ticketRef");

-- CreateIndex
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_action_idx" ON "AuditLog"("userId", "action");

-- CreateIndex
CREATE INDEX "AuditLog_phase_createdAt_idx" ON "AuditLog"("phase", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "StakingWallet_walletAddress_key" ON "StakingWallet"("walletAddress");

-- CreateIndex
CREATE INDEX "StakingWallet_asset_idx" ON "StakingWallet"("asset");

-- CreateIndex
CREATE INDEX "StakingWallet_rewardModel_idx" ON "StakingWallet"("rewardModel");

-- CreateIndex
CREATE INDEX "StakingWallet_status_idx" ON "StakingWallet"("status");

-- CreateIndex
CREATE INDEX "DailyCheckRun_date_idx" ON "DailyCheckRun"("date");

-- CreateIndex
CREATE INDEX "DailyCheckItem_runId_idx" ON "DailyCheckItem"("runId");

-- CreateIndex
CREATE INDEX "DailyCheckItem_category_idx" ON "DailyCheckItem"("category");

-- CreateIndex
CREATE INDEX "DailyCheckItem_status_idx" ON "DailyCheckItem"("status");

-- CreateIndex
CREATE INDEX "DailyCheckItem_definitionCode_idx" ON "DailyCheckItem"("definitionCode");

-- CreateIndex
CREATE UNIQUE INDEX "DailyCheckItem_definitionCode_periodKey_key" ON "DailyCheckItem"("definitionCode", "periodKey");

-- CreateIndex
CREATE INDEX "DailyCheckDefinition_team_isActive_idx" ON "DailyCheckDefinition"("team", "isActive");

-- CreateIndex
CREATE INDEX "DailyCheckDefinition_isActive_idx" ON "DailyCheckDefinition"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningEntry_transactionId_key" ON "ScreeningEntry"("transactionId");

-- CreateIndex
CREATE INDEX "ScreeningEntry_screeningStatus_idx" ON "ScreeningEntry"("screeningStatus");

-- CreateIndex
CREATE INDEX "ScreeningEntry_classification_idx" ON "ScreeningEntry"("classification");

-- CreateIndex
CREATE INDEX "ScreeningEntry_asset_idx" ON "ScreeningEntry"("asset");

-- CreateIndex
CREATE INDEX "TokenReview_status_idx" ON "TokenReview"("status");

-- CreateIndex
CREATE INDEX "TokenReview_riskLevel_idx" ON "TokenReview"("riskLevel");

-- CreateIndex
CREATE INDEX "TokenReview_demandScore_idx" ON "TokenReview"("demandScore");

-- CreateIndex
CREATE UNIQUE INDEX "TokenReview_symbol_network_key" ON "TokenReview"("symbol", "network");

-- CreateIndex
CREATE INDEX "TokenDemandSignal_tokenReviewId_idx" ON "TokenDemandSignal"("tokenReviewId");

-- CreateIndex
CREATE INDEX "WorkflowEvent_entityType_entityId_idx" ON "WorkflowEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "WorkflowEvent_createdAt_idx" ON "WorkflowEvent"("createdAt");

-- CreateIndex
CREATE INDEX "WorkflowEvent_entityType_entityId_createdAt_idx" ON "WorkflowEvent"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DataRetentionPolicy_entityType_key" ON "DataRetentionPolicy"("entityType");

-- CreateIndex
CREATE INDEX "WebhookEvent_source_status_idx" ON "WebhookEvent"("source", "status");

-- CreateIndex
CREATE INDEX "WebhookEvent_createdAt_idx" ON "WebhookEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_source_eventId_key" ON "WebhookEvent"("source", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionMetadata_sessionToken_key" ON "SessionMetadata"("sessionToken");

-- CreateIndex
CREATE INDEX "SessionMetadata_userId_idx" ON "SessionMetadata"("userId");

-- CreateIndex
CREATE INDEX "SessionMetadata_expiresAt_idx" ON "SessionMetadata"("expiresAt");

-- CreateIndex
CREATE INDEX "SessionMetadata_userId_expiresAt_idx" ON "SessionMetadata"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "TransactionConfirmation_status_idx" ON "TransactionConfirmation"("status");

-- CreateIndex
CREATE INDEX "TransactionConfirmation_riskLevel_idx" ON "TransactionConfirmation"("riskLevel");

-- CreateIndex
CREATE INDEX "TransactionConfirmation_riskLevel_status_idx" ON "TransactionConfirmation"("riskLevel", "status");

-- CreateIndex
CREATE INDEX "TransactionConfirmation_createdAt_idx" ON "TransactionConfirmation"("createdAt");

-- CreateIndex
CREATE INDEX "TransactionConfirmation_expiresAt_idx" ON "TransactionConfirmation"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionConfirmation_transactionId_key" ON "TransactionConfirmation"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");

-- CreateIndex
CREATE INDEX "FeatureFlag_key_idx" ON "FeatureFlag"("key");

-- CreateIndex
CREATE INDEX "FeatureFlag_enabled_idx" ON "FeatureFlag"("enabled");

-- CreateIndex
CREATE INDEX "BackgroundJob_status_nextRunAt_idx" ON "BackgroundJob"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "BackgroundJob_type_idx" ON "BackgroundJob"("type");

-- CreateIndex
CREATE INDEX "BackgroundJob_isRecurring_status_idx" ON "BackgroundJob"("isRecurring", "status");

-- CreateIndex
CREATE INDEX "BackgroundJob_deduplicationKey_idx" ON "BackgroundJob"("deduplicationKey");

-- CreateIndex
CREATE INDEX "BackgroundJobRun_type_finishedAt_idx" ON "BackgroundJobRun"("type", "finishedAt");

-- CreateIndex
CREATE INDEX "BackgroundJobRun_status_finishedAt_idx" ON "BackgroundJobRun"("status", "finishedAt");

-- CreateIndex
CREATE INDEX "BackgroundJobRun_jobId_idx" ON "BackgroundJobRun"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "SlackChannel_channelId_key" ON "SlackChannel"("channelId");

-- CreateIndex
CREATE INDEX "SlackChannel_clientId_idx" ON "SlackChannel"("clientId");

-- CreateIndex
CREATE INDEX "SlackChannel_purpose_isActive_idx" ON "SlackChannel"("purpose", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceProvider_name_key" ON "ServiceProvider"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ClientServiceDependency_clientName_providerId_key" ON "ClientServiceDependency"("clientName", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientImpactRecord_incidentId_clientName_key" ON "ClientImpactRecord"("incidentId", "clientName");

-- CreateIndex
CREATE UNIQUE INDEX "StatusPageEvent_providerId_externalId_key" ON "StatusPageEvent"("providerId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_custodyOrgId_key" ON "Client"("custodyOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_jsmOrganizationId_key" ON "Client"("jsmOrganizationId");

-- CreateIndex
CREATE INDEX "Client_isActive_idx" ON "Client"("isActive");

-- CreateIndex
CREATE INDEX "UserClientScope_clientId_idx" ON "UserClientScope"("clientId");

-- CreateIndex
CREATE INDEX "ClientChannel_clientId_idx" ON "ClientChannel"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientChannel_kind_ref_key" ON "ClientChannel"("kind", "ref");

-- CreateIndex
CREATE INDEX "WorkItem_state_team_idx" ON "WorkItem"("state", "team");

-- CreateIndex
CREATE INDEX "WorkItem_clientId_idx" ON "WorkItem"("clientId");

-- CreateIndex
CREATE INDEX "WorkItem_ticketKey_idx" ON "WorkItem"("ticketKey");

-- CreateIndex
CREATE INDEX "WorkItem_taskCode_state_idx" ON "WorkItem"("taskCode", "state");

-- CreateIndex
CREATE INDEX "WorkItem_ownerEmployeeId_idx" ON "WorkItem"("ownerEmployeeId");

-- CreateIndex
CREATE INDEX "WorkItem_slaPolicyId_idx" ON "WorkItem"("slaPolicyId");

-- CreateIndex
CREATE INDEX "WorkItem_kind_state_idx" ON "WorkItem"("kind", "state");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItem_sourceSystem_sourceId_key" ON "WorkItem"("sourceSystem", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "SlaPolicy_code_key" ON "SlaPolicy"("code");

-- CreateIndex
CREATE INDEX "SlaPolicy_isActive_idx" ON "SlaPolicy"("isActive");

-- CreateIndex
CREATE INDEX "SlaEvent_workItemId_idx" ON "SlaEvent"("workItemId");

-- CreateIndex
CREATE INDEX "SlaEvent_kind_idx" ON "SlaEvent"("kind");

-- CreateIndex
CREATE INDEX "AlertRule_enabled_idx" ON "AlertRule"("enabled");

-- CreateIndex
CREATE INDEX "TimeLog_workItemId_idx" ON "TimeLog"("workItemId");

-- CreateIndex
CREATE INDEX "TimeLog_clientId_idx" ON "TimeLog"("clientId");

-- CreateIndex
CREATE INDEX "TimeLog_loggedById_idx" ON "TimeLog"("loggedById");

-- CreateIndex
CREATE INDEX "TicketLink_workItemId_idx" ON "TicketLink"("workItemId");

-- CreateIndex
CREATE INDEX "TicketLink_system_key_idx" ON "TicketLink"("system", "key");

-- CreateIndex
CREATE UNIQUE INDEX "TicketLink_system_key_workItemId_key" ON "TicketLink"("system", "key", "workItemId");

-- CreateIndex
CREATE INDEX "IncidentLogDraft_workItemId_idx" ON "IncidentLogDraft"("workItemId");

-- CreateIndex
CREATE INDEX "IncidentLogDraft_dueAt_completedAt_idx" ON "IncidentLogDraft"("dueAt", "completedAt");

-- CreateIndex
CREATE INDEX "SourceRecord_source_kind_status_idx" ON "SourceRecord"("source", "kind", "status");

-- CreateIndex
CREATE INDEX "SourceRecord_kind_mappedStatus_idx" ON "SourceRecord"("kind", "mappedStatus");

-- CreateIndex
CREATE INDEX "SourceRecord_lastSeenAt_idx" ON "SourceRecord"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "SourceRecord_source_kind_externalId_key" ON "SourceRecord"("source", "kind", "externalId");

-- CreateIndex
CREATE INDEX "JiraProjectConfig_enabled_idx" ON "JiraProjectConfig"("enabled");

-- CreateIndex
CREATE INDEX "JiraIssueEvent_key_idx" ON "JiraIssueEvent"("key");

-- CreateIndex
CREATE INDEX "JiraIssueEvent_workItemId_idx" ON "JiraIssueEvent"("workItemId");

-- CreateIndex
CREATE UNIQUE INDEX "JiraIssueEvent_system_key_updated_key" ON "JiraIssueEvent"("system", "key", "updated");

-- CreateIndex
CREATE UNIQUE INDEX "OesWindow_exchange_cron_key" ON "OesWindow"("exchange", "cron");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovedValidator_chain_validator_key" ON "ApprovedValidator"("chain", "validator");

-- CreateIndex
CREATE INDEX "SettlementNote_windowKey_idx" ON "SettlementNote"("windowKey");

-- CreateIndex
CREATE UNIQUE INDEX "BankInstruction_reference_key" ON "BankInstruction"("reference");

-- CreateIndex
CREATE INDEX "BankInstruction_ackStatus_idx" ON "BankInstruction"("ackStatus");

-- CreateIndex
CREATE INDEX "BankInstruction_valueDate_idx" ON "BankInstruction"("valueDate");

-- CreateIndex
CREATE INDEX "BankSettlementLog_reference_idx" ON "BankSettlementLog"("reference");

-- CreateIndex
CREATE INDEX "BankSettlementLog_status_idx" ON "BankSettlementLog"("status");

-- CreateIndex
CREATE INDEX "BankFeeBalance_walletRef_recordedAt_idx" ON "BankFeeBalance"("walletRef", "recordedAt");

-- CreateIndex
CREATE INDEX "InAppNotification_userId_readAt_idx" ON "InAppNotification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "PollCycle_source_startedAt_idx" ON "PollCycle"("source", "startedAt");

-- CreateIndex
CREATE INDEX "ClientUpdate_workItemId_idx" ON "ClientUpdate"("workItemId");

-- CreateIndex
CREATE INDEX "OutboundMessageDraft_workItemId_idx" ON "OutboundMessageDraft"("workItemId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadHandover_date_team_key" ON "LeadHandover"("date", "team");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformSprint_sprint_key" ON "PlatformSprint"("sprint");

-- CreateIndex
CREATE INDEX "PlatformChange_sprintId_removedAt_idx" ON "PlatformChange"("sprintId", "removedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformChange_sprintId_section_rowHash_key" ON "PlatformChange"("sprintId", "section", "rowHash");

-- CreateIndex
CREATE INDEX "_archived_approval_audit_entry_requestId_idx" ON "_archived_approval_audit_entry"("requestId");

-- CreateIndex
CREATE INDEX "_archived_approval_audit_entry_performedById_idx" ON "_archived_approval_audit_entry"("performedById");

-- CreateIndex
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryScore" ADD CONSTRAINT "CategoryScore_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryScore" ADD CONSTRAINT "CategoryScore_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "TimePeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeScore" ADD CONSTRAINT "KnowledgeScore_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeScore" ADD CONSTRAINT "KnowledgeScore_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "TimePeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeScore" ADD CONSTRAINT "KnowledgeScore_scoredById_fkey" FOREIGN KEY ("scoredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoringConfig" ADD CONSTRAINT "ScoringConfig_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoringConfig" ADD CONSTRAINT "ScoringConfig_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoringConfig" ADD CONSTRAINT "ScoringConfig_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeNote" ADD CONSTRAINT "EmployeeNote_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsThread" ADD CONSTRAINT "CommsThread_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsThread" ADD CONSTRAINT "CommsThread_slackChannelId_fkey" FOREIGN KEY ("slackChannelId") REFERENCES "SlackChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsMessage" ADD CONSTRAINT "CommsMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommsThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipChange" ADD CONSTRAINT "OwnershipChange_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommsThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipChange" ADD CONSTRAINT "OwnershipChange_oldOwnerId_fkey" FOREIGN KEY ("oldOwnerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipChange" ADD CONSTRAINT "OwnershipChange_newOwnerId_fkey" FOREIGN KEY ("newOwnerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipChange" ADD CONSTRAINT "OwnershipChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThreadNote" ADD CONSTRAINT "ThreadNote_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommsThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThreadNote" ADD CONSTRAINT "ThreadNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThreadParticipant" ADD CONSTRAINT "ThreadParticipant_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommsThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThreadLinkedRecord" ADD CONSTRAINT "ThreadLinkedRecord_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommsThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommsMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEvidence" ADD CONSTRAINT "ScoreEvidence_scoreId_fkey" FOREIGN KEY ("scoreId") REFERENCES "CategoryScore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTag" ADD CONSTRAINT "ProjectTag_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTag" ADD CONSTRAINT "WalletTag_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "StakingWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContactPreference" ADD CONSTRAINT "ClientContactPreference_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "TravelRuleCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnCallSchedule" ADD CONSTRAINT "OnCallSchedule_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtoRecord" ADD CONSTRAINT "PtoRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTask" ADD CONSTRAINT "DailyTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTask" ADD CONSTRAINT "DailyTask_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTask" ADD CONSTRAINT "DailyTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotaAssignment" ADD CONSTRAINT "RotaAssignment_subTeamId_fkey" FOREIGN KEY ("subTeamId") REFERENCES "SubTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotaAssignment" ADD CONSTRAINT "RotaAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectUpdate" ADD CONSTRAINT "ProjectUpdate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectUpdate" ADD CONSTRAINT "ProjectUpdate_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityStatus" ADD CONSTRAINT "ActivityStatus_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommsThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_travelRuleCaseId_fkey" FOREIGN KEY ("travelRuleCaseId") REFERENCES "TravelRuleCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_rcaResponsibleId_fkey" FOREIGN KEY ("rcaResponsibleId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentUpdate" ADD CONSTRAINT "IncidentUpdate_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalTicketEvent" ADD CONSTRAINT "ExternalTicketEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCheckItem" ADD CONSTRAINT "DailyCheckItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DailyCheckRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCheckItem" ADD CONSTRAINT "DailyCheckItem_definitionCode_fkey" FOREIGN KEY ("definitionCode") REFERENCES "DailyCheckDefinition"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenDemandSignal" ADD CONSTRAINT "TokenDemandSignal_tokenReviewId_fkey" FOREIGN KEY ("tokenReviewId") REFERENCES "TokenReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEvent" ADD CONSTRAINT "WorkflowEvent_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlackChannel" ADD CONSTRAINT "SlackChannel_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientServiceDependency" ADD CONSTRAINT "ClientServiceDependency_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientImpactRecord" ADD CONSTRAINT "ClientImpactRecord_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusPageEvent" ADD CONSTRAINT "StatusPageEvent_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorReliabilityScore" ADD CONSTRAINT "VendorReliabilityScore_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserClientScope" ADD CONSTRAINT "UserClientScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserClientScope" ADD CONSTRAINT "UserClientScope_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientChannel" ADD CONSTRAINT "ClientChannel_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_slaPolicyId_fkey" FOREIGN KEY ("slaPolicyId") REFERENCES "SlaPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaEvent" ADD CONSTRAINT "SlaEvent_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeLog" ADD CONSTRAINT "TimeLog_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeLog" ADD CONSTRAINT "TimeLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeLog" ADD CONSTRAINT "TimeLog_loggedById_fkey" FOREIGN KEY ("loggedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketLink" ADD CONSTRAINT "TicketLink_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentLogDraft" ADD CONSTRAINT "IncidentLogDraft_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformChange" ADD CONSTRAINT "PlatformChange_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "PlatformSprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Database-enforced controls
CREATE FUNCTION kom_audit_details(d text) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
  j JSONB;
BEGIN
  IF d IS NULL OR d = '' THEN RETURN '{}'::jsonb; END IF;
  BEGIN
    j := d::jsonb;
    IF jsonb_typeof(j) = 'string' THEN j := (j #>> '{}')::jsonb; END IF;
    IF jsonb_typeof(j) <> 'object' THEN RETURN '{}'::jsonb; END IF;
    RETURN j;
  EXCEPTION WHEN others THEN
    RETURN '{}'::jsonb;
  END;
END $$;

CREATE FUNCTION kom_audit_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only (% rejected)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE FUNCTION kom_audit_normalise_actor() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  emp TEXT;
  meta_user TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Employee" WHERE "id" = NEW."userId") THEN
    SELECT "employeeId" INTO emp FROM "User" WHERE "id" = NEW."userId";
    IF FOUND THEN
      NEW."actorUserId" := COALESCE(NEW."actorUserId", NEW."userId");
      NEW."userId" := COALESCE(emp, 'system');
    END IF;
  END IF;
  IF NEW."actorUserId" IS NULL THEN
    meta_user := kom_audit_details(NEW."details"::text) -> 'metadata' ->> 'actorUserId';
    IF meta_user IS NOT NULL THEN NEW."actorUserId" := meta_user; END IF;
  END IF;
  IF NEW."userId" = 'system' AND NEW."actorUserId" IS NULL AND NEW."actorType" = 'user' THEN
    NEW."actorType" := 'system';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION kom_job_run_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'BackgroundJobRun is append-only (UPDATE rejected)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD."finishedAt" IS NULL
       OR (OLD."status" = 'succeeded' AND OLD."finishedAt" >= now() - interval '30 days')
       OR (OLD."status" <> 'succeeded' AND OLD."finishedAt" >= now() - interval '400 days') THEN
      RAISE EXCEPTION 'BackgroundJobRun row is inside its retention period (DELETE rejected)' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION kom_job_run_no_truncate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'BackgroundJobRun cannot be truncated' USING ERRCODE = 'insufficient_privilege';
END;
$$;


CREATE UNIQUE INDEX "Alert_open_ruleCode_dedupeKey_key" ON "Alert" USING btree ("ruleCode", "dedupeKey") WHERE (status <> 'resolved'::"AlertStatus");

CREATE UNIQUE INDEX "ScoringConfig_active_unique" ON "ScoringConfig" USING btree (active) WHERE (active = true);

CREATE TRIGGER "AuditLog_normalise_actor" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION kom_audit_normalise_actor();

CREATE TRIGGER "AuditLog_no_update_delete" BEFORE DELETE OR UPDATE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION kom_audit_append_only();

CREATE TRIGGER "AuditLog_no_truncate" BEFORE TRUNCATE ON "AuditLog" FOR EACH STATEMENT EXECUTE FUNCTION kom_audit_append_only();

CREATE TRIGGER "BackgroundJobRun_append_only" BEFORE DELETE OR UPDATE ON "BackgroundJobRun" FOR EACH ROW EXECUTE FUNCTION kom_job_run_append_only();

CREATE TRIGGER "BackgroundJobRun_no_truncate" BEFORE TRUNCATE ON "BackgroundJobRun" FOR EACH STATEMENT EXECUTE FUNCTION kom_job_run_no_truncate();

-- 3. Reference data
INSERT INTO "Employee" (id, name, email, role, team, region, active, "createdAt", "updatedAt") VALUES ('system', 'System', 'system@kommand.invalid', 'Analyst', 'TransactionOperations', 'Global', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "SlaPolicy" (id, code, description, "ownershipMins", "firstRespMins", "resolveMins", "resolveRule", calendar, "warnAtPct", "breachEscalationRole", version, "isActive", "createdAt", "updatedAt") VALUES ('slapol_client_q_p0', 'CLIENT-Q-P0', 'Client question, priority P0', NULL, NULL, NULL, NULL, '24x7', 50, 'lead', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "SlaPolicy" (id, code, description, "ownershipMins", "firstRespMins", "resolveMins", "resolveRule", calendar, "warnAtPct", "breachEscalationRole", version, "isActive", "createdAt", "updatedAt") VALUES ('slapol_client_q_p1', 'CLIENT-Q-P1', 'Client question, priority P1', NULL, NULL, NULL, NULL, '24x7', 50, 'lead', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "SlaPolicy" (id, code, description, "ownershipMins", "firstRespMins", "resolveMins", "resolveRule", calendar, "warnAtPct", "breachEscalationRole", version, "isActive", "createdAt", "updatedAt") VALUES ('slapol_client_q_p2', 'CLIENT-Q-P2', 'Client question, priority P2', NULL, NULL, NULL, NULL, '24x7', 50, 'lead', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "SlaPolicy" (id, code, description, "ownershipMins", "firstRespMins", "resolveMins", "resolveRule", calendar, "warnAtPct", "breachEscalationRole", version, "isActive", "createdAt", "updatedAt") VALUES ('slapol_client_q_p3', 'CLIENT-Q-P3', 'Client question, priority P3', NULL, NULL, NULL, NULL, '24x7', 50, 'lead', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "SlaPolicy" (id, code, description, "ownershipMins", "firstRespMins", "resolveMins", "resolveRule", calendar, "warnAtPct", "breachEscalationRole", version, "isActive", "createdAt", "updatedAt") VALUES ('slapol_oes_fail', 'OES-FAIL', 'OES settlement failure: exchange contacted within 120 minutes of the settlement window start', NULL, 120, NULL, NULL, '24x7', 50, 'lead', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "SlaPolicy" (id, code, description, "ownershipMins", "firstRespMins", "resolveMins", "resolveRule", calendar, "warnAtPct", "breachEscalationRole", version, "isActive", "createdAt", "updatedAt") VALUES ('slapol_bank_ack', 'BANK-ACK', 'Bank instruction acknowledged (CONFIRM-BANK-ACK-MINS)', NULL, NULL, NULL, NULL, '24x7', 50, 'lead', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "SlaPolicy" (id, code, description, "ownershipMins", "firstRespMins", "resolveMins", "resolveRule", calendar, "warnAtPct", "breachEscalationRole", version, "isActive", "createdAt", "updatedAt") VALUES ('slapol_mtd_break', 'MTD-BREAK', 'MTD break closed T+1: by end of the next business day after reporting', NULL, NULL, NULL, 'next_business_day_eod', 'business_uk', 50, 'lead', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "SlaPolicy" (id, code, description, "ownershipMins", "firstRespMins", "resolveMins", "resolveRule", calendar, "warnAtPct", "breachEscalationRole", version, "isActive", "createdAt", "updatedAt") VALUES ('slapol_client_incident_update', 'CLIENT-INCIDENT-UPDATE', 'Maximum time between client-visible updates while a client incident or risk is open', NULL, NULL, NULL, NULL, '24x7', 50, 'lead', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "AlertRule" (code, enabled, severity, params, route, version, "createdAt", "updatedAt", "lastEvaluatedAt") VALUES ('ALR-TKT-01', false, 'high', '{}', '{"outOfHours": [], "businessHours": []}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL);
INSERT INTO "AlertRule" (code, enabled, severity, params, route, version, "createdAt", "updatedAt", "lastEvaluatedAt") VALUES ('ALR-TKT-02', false, 'medium', '{}', '{"outOfHours": [], "businessHours": []}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL);
INSERT INTO "AlertRule" (code, enabled, severity, params, route, version, "createdAt", "updatedAt", "lastEvaluatedAt") VALUES ('ALR-INCLOG-01', false, 'high', '{}', '{"outOfHours": ["role:admin"], "businessHours": ["role:admin"]}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL);
INSERT INTO "AssetThreshold" (asset, "stuckMins", "createdAt", "updatedAt") VALUES ('*', 120, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "PlatformImpactRule" (id, name, "matchOn", pattern, "taskCodes", "alertCodes", controls, team, "uatTemplate", priority, "isActive", version, "createdAt", "updatedAt") VALUES ('pir_staking_ws', 'Staking workstream', 'workstream', '^staking$', '["CHK-16", "CHK-17", "CHK-21", "CHK-22"]', '[]', '[]', 'Team 3', 'UAT-STAKING', 'P2', false, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "PlatformImpactRule" (id, name, "matchOn", pattern, "taskCodes", "alertCodes", controls, team, "uatTemplate", priority, "isActive", version, "createdAt", "updatedAt") VALUES ('pir_staking_sec', 'Stake / Unstake section', 'section', 'stake\s*/\s*unstake', '["CHK-16", "CHK-17", "CHK-21", "CHK-22"]', '[]', '[]', 'Team 3', 'UAT-STAKING', 'P2', false, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "PlatformImpactRule" (id, name, "matchOn", pattern, "taskCodes", "alertCodes", controls, team, "uatTemplate", priority, "isActive", version, "createdAt", "updatedAt") VALUES ('pir_risk_ws', 'Tx Automation workstream', 'workstream', 'tx automation', '["TASK-RISKVIEW"]', '["ALR-RSK-*"]', '[]', 'All', 'UAT-RISK-ENGINE', 'P1', false, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "PlatformImpactRule" (id, name, "matchOn", pattern, "taskCodes", "alertCodes", controls, team, "uatTemplate", priority, "isActive", version, "createdAt", "updatedAt") VALUES ('pir_risk_sec', 'Risk Engine section', 'section', 'risk engine', '["TASK-RISKVIEW"]', '["ALR-RSK-*"]', '[]', 'All', 'UAT-RISK-ENGINE', 'P1', false, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "PlatformImpactRule" (id, name, "matchOn", pattern, "taskCodes", "alertCodes", controls, team, "uatTemplate", priority, "isActive", version, "createdAt", "updatedAt") VALUES ('pir_collateral', 'Collateral Management workstream', 'workstream', 'collateral management', '["CHK-10"]', '["ALR-OES-*"]', '[]', 'Team 1', 'UAT-COLLATERAL', 'P2', false, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "PlatformImpactRule" (id, name, "matchOn", pattern, "taskCodes", "alertCodes", controls, team, "uatTemplate", priority, "isActive", version, "createdAt", "updatedAt") VALUES ('pir_bank', 'Bank Integration workstream', 'workstream', 'bank integration', '["TASK-BANK"]', '["ALR-BANK-*"]', '[]', 'Team 1', 'UAT-BANK', 'P2', false, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "PlatformImpactRule" (id, name, "matchOn", pattern, "taskCodes", "alertCodes", controls, team, "uatTemplate", priority, "isActive", version, "createdAt", "updatedAt") VALUES ('pir_travel_rule', 'Travel Rule workstream', 'workstream', 'travel rule', '["CHK-09"]', '["ALR-TR-01"]', '[]', 'Team 3', 'UAT-TRAVEL-RULE', 'P2', false, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "PlatformImpactRule" (id, name, "matchOn", pattern, "taskCodes", "alertCodes", controls, team, "uatTemplate", priority, "isActive", version, "createdAt", "updatedAt") VALUES ('pir_api_ws', 'Custody API workstream', 'workstream', 'custody api', '["KOMMAND-CONNECTOR"]', '["ALR-HB-*", "ALR-CFG-02"]', '[]', 'Head of Operations', 'UAT-CUSTODY-API', 'P2', false, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "PlatformImpactRule" (id, name, "matchOn", pattern, "taskCodes", "alertCodes", controls, team, "uatTemplate", priority, "isActive", version, "createdAt", "updatedAt") VALUES ('pir_api_sec', 'New API section', 'section', 'new api', '["KOMMAND-CONNECTOR"]', '["ALR-HB-*", "ALR-CFG-02"]', '[]', 'Head of Operations', 'UAT-CUSTODY-API', 'P2', false, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "PlatformImpactRule" (id, name, "matchOn", pattern, "taskCodes", "alertCodes", controls, team, "uatTemplate", priority, "isActive", version, "createdAt", "updatedAt") VALUES ('pir_fees', 'Fee Management workstream', 'workstream', 'fee management', '["TASK-BANK", "TASK-BILL"]', '["ALR-BANK-08"]', '[]', 'Team 1', 'UAT-FEES', 'P2', false, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "PlatformImpactRule" (id, name, "matchOn", pattern, "taskCodes", "alertCodes", controls, team, "uatTemplate", priority, "isActive", version, "createdAt", "updatedAt") VALUES ('pir_analytics', 'Analytics views (deployment notes)', 'keyword', 'analytics\.|\brenamed?\b|\bviews?\b', '["CHK-02", "CHK-05"]', '[]', '[]', 'Team 2', 'UAT-ANALYTICS', 'P2', false, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "PlatformImpactRule" (id, name, "matchOn", pattern, "taskCodes", "alertCodes", controls, team, "uatTemplate", priority, "isActive", version, "createdAt", "updatedAt") VALUES ('pir_permissions', 'Changes in Permission section', 'section', 'changes in permission', '["ACCESS-REVIEW"]', '[]', '[]', 'Head of Operations', 'UAT-PERMISSIONS', 'P2', false, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "PlatformImpactRule" (id, name, "matchOn", pattern, "taskCodes", "alertCodes", controls, team, "uatTemplate", priority, "isActive", version, "createdAt", "updatedAt") VALUES ('pir_client_ui', 'Client UI / on-boarding workstream', 'workstream', 'client ui|client on-?boarding', '["CLIENT-AWARENESS"]', '[]', '[]', 'All', 'UAT-CLIENT-AWARENESS', 'P3', false, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "IncidentCategory" (code, label, "complianceSensitive", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES ('settlement_failure', 'Settlement failure', false, true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "IncidentCategory" (code, label, "complianceSensitive", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES ('withdrawal_delay', 'Withdrawal delay', false, true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "IncidentCategory" (code, label, "complianceSensitive", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES ('platform_issue', 'Platform issue', false, true, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "IncidentCategory" (code, label, "complianceSensitive", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES ('phishing_impersonation', 'Phishing or impersonation', false, true, 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "IncidentCategory" (code, label, "complianceSensitive", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES ('account_compromise_suspected', 'Account compromise suspected', false, true, 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "IncidentCategory" (code, label, "complianceSensitive", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES ('data_issue', 'Data issue', false, true, 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "IncidentCategory" (code, label, "complianceSensitive", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES ('other', 'Other', false, true, 70, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "IncidentCategory" (code, label, "complianceSensitive", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES ('kyt_alert', 'KYT alert', true, true, 100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "IncidentCategory" (code, label, "complianceSensitive", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES ('sanctions', 'Sanctions', true, true, 110, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "IncidentCategory" (code, label, "complianceSensitive", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES ('suspected_financial_crime', 'Suspected financial crime', true, true, 120, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "IncidentCategory" (code, label, "complianceSensitive", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES ('suspicious_activity', 'Suspicious activity', true, true, 130, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "JiraProjectConfig" (key, name, purpose, kind, enabled, "syncInbound", "defaultWorkItemKind", "defaultTeam", "defaultTaskCode", "serviceDeskId", "issueTypeIds", "allowedCustomFields", "createdAt", "updatedAt") VALUES ('OTC', 'Operation Transaction Changes', 'MTD breaks, EOD balance requests, internal transaction uploads, voids (reconciliation and ticketing only)', 'jira', false, true, 'internal_task', 'All', 'JIRA-OTC', NULL, '{}', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "JiraProjectConfig" (key, name, purpose, kind, enabled, "syncInbound", "defaultWorkItemKind", "defaultTeam", "defaultTaskCode", "serviceDeskId", "issueTypeIds", "allowedCustomFields", "createdAt", "updatedAt") VALUES ('OPS', 'Transaction Operations', 'Daily task tickets', 'jira', false, true, 'internal_task', 'All', 'JIRA-OPS', NULL, '{}', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "JiraProjectConfig" (key, name, purpose, kind, enabled, "syncInbound", "defaultWorkItemKind", "defaultTeam", "defaultTaskCode", "serviceDeskId", "issueTypeIds", "allowedCustomFields", "createdAt", "updatedAt") VALUES ('VND', 'Vendor service requests', 'Vendor RCA and issue tickets', 'jira', false, true, 'vendor_ticket', 'All', 'JIRA-VND', NULL, '{}', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "JiraProjectConfig" (key, name, purpose, kind, enabled, "syncInbound", "defaultWorkItemKind", "defaultTeam", "defaultTaskCode", "serviceDeskId", "issueTypeIds", "allowedCustomFields", "createdAt", "updatedAt") VALUES ('PDEF', 'Platform Service Management', 'Platform issues raised by the team', 'jira', false, true, 'internal_task', 'All', 'JIRA-PDEF', NULL, '{}', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "JiraProjectConfig" (key, name, purpose, kind, enabled, "syncInbound", "defaultWorkItemKind", "defaultTeam", "defaultTaskCode", "serviceDeskId", "issueTypeIds", "allowedCustomFields", "createdAt", "updatedAt") VALUES ('INC', 'Issues and Incidents Log', 'Incidents (shared with other departments)', 'jira', false, true, 'incident', 'All', 'JIRA-INC', NULL, '{}', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "JiraProjectConfig" (key, name, purpose, kind, enabled, "syncInbound", "defaultWorkItemKind", "defaultTeam", "defaultTaskCode", "serviceDeskId", "issueTypeIds", "allowedCustomFields", "createdAt", "updatedAt") VALUES ('RLS', 'Law-enforcement realisations', 'Asset realisation and return of assets', 'jira', false, true, 'realisation_case', 'All', 'JIRA-RLS', NULL, '{}', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "JiraProjectConfig" (key, name, purpose, kind, enabled, "syncInbound", "defaultWorkItemKind", "defaultTeam", "defaultTaskCode", "serviceDeskId", "issueTypeIds", "allowedCustomFields", "createdAt", "updatedAt") VALUES ('TOKENS', 'Token Listing', 'Coin reviews', 'jira', false, true, 'coin_review', 'All', 'JIRA-TOKENS', NULL, '{}', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "JiraProjectConfig" (key, name, purpose, kind, enabled, "syncInbound", "defaultWorkItemKind", "defaultTeam", "defaultTaskCode", "serviceDeskId", "issueTypeIds", "allowedCustomFields", "createdAt", "updatedAt") VALUES ('FIN', 'Finance Ops Approvals', 'Billing and fee approvals (visibility only)', 'jira', false, false, 'internal_task', 'All', 'JIRA-FIN', NULL, '{}', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "JiraProjectConfig" (key, name, purpose, kind, enabled, "syncInbound", "defaultWorkItemKind", "defaultTeam", "defaultTaskCode", "serviceDeskId", "issueTypeIds", "allowedCustomFields", "createdAt", "updatedAt") VALUES ('AO', 'Admin Operations', 'Cross-team items (visibility only)', 'jira', false, false, 'internal_task', 'All', 'JIRA-AO', NULL, '{}', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "JiraProjectConfig" (key, name, purpose, kind, enabled, "syncInbound", "defaultWorkItemKind", "defaultTeam", "defaultTaskCode", "serviceDeskId", "issueTypeIds", "allowedCustomFields", "createdAt", "updatedAt") VALUES ('EXT', 'EXT', 'TODO(CONFIRM-PROJECT-ROLES): confirm purpose before enabling', 'jira', false, false, 'internal_task', 'All', 'JIRA-EXT', NULL, '{}', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "User" (id, email, name, role, password, "employeeId", "createdAt", "updatedAt") VALUES ('system', 'system@internal', 'System', 'admin', '$2b$10$000000000000000000000uLockAccountNoLoginPossible000000000', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "OesWindow" (id, exchange, cron, "durationMins", "referenceTz", "isActive", "createdAt", "updatedAt") VALUES ('oes-exch-c', 'exch-c', '15 9 * * *', 15, 'UTC', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "OesWindow" (id, exchange, cron, "durationMins", "referenceTz", "isActive", "createdAt", "updatedAt") VALUES ('oes-exch-b', 'exch-b', '0 */6 * * *', 30, 'UTC', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "OesWindow" (id, exchange, cron, "durationMins", "referenceTz", "isActive", "createdAt", "updatedAt") VALUES ('oes-exch-a', 'exch-a', '0 9 * * *', 30, 'UTC', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "RiskRuleTier" (rule, tier, note, "createdAt", "updatedAt") VALUES (1, 'high', 'Current approved flow', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "RiskRuleTier" (rule, tier, note, "createdAt", "updatedAt") VALUES (2, 'high', 'Current approved flow', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "RiskRuleTier" (rule, tier, note, "createdAt", "updatedAt") VALUES (3, 'high', 'Current approved flow', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "RiskRuleTier" (rule, tier, note, "createdAt", "updatedAt") VALUES (4, 'high', 'Current approved flow', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "RiskRuleTier" (rule, tier, note, "createdAt", "updatedAt") VALUES (5, 'high', 'Current approved flow', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "RiskRuleTier" (rule, tier, note, "createdAt", "updatedAt") VALUES (6, 'high', 'Current approved flow', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "RiskRuleTier" (rule, tier, note, "createdAt", "updatedAt") VALUES (7, 'high', 'Current approved flow', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "RiskRuleTier" (rule, tier, note, "createdAt", "updatedAt") VALUES (8, 'high', 'Current approved flow', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "RiskRuleTier" (rule, tier, note, "createdAt", "updatedAt") VALUES (9, 'high', 'Current approved flow', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "RiskRuleTier" (rule, tier, note, "createdAt", "updatedAt") VALUES (10, 'high', 'Current approved flow', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "RiskRuleTier" (rule, tier, note, "createdAt", "updatedAt") VALUES (11, 'high', 'Current approved flow', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "RiskRuleTier" (rule, tier, note, "createdAt", "updatedAt") VALUES (12, 'high', 'Current approved flow', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "TeamConfig" (team, "leadEmployeeId", "deputyEmployeeId", "createdAt", "updatedAt", "memberEmployeeIds") VALUES ('Team 1', NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '[]');
INSERT INTO "TeamConfig" (team, "leadEmployeeId", "deputyEmployeeId", "createdAt", "updatedAt", "memberEmployeeIds") VALUES ('Team 2', NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '[]');
INSERT INTO "TeamConfig" (team, "leadEmployeeId", "deputyEmployeeId", "createdAt", "updatedAt", "memberEmployeeIds") VALUES ('Team 3', NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '[]');
INSERT INTO "UatTemplate" (code, title, steps, "expectedResults", "evidenceRequired", "createdAt", "updatedAt") VALUES ('UAT-STAKING', 'Staking changes', '', '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "UatTemplate" (code, title, steps, "expectedResults", "evidenceRequired", "createdAt", "updatedAt") VALUES ('UAT-RISK-ENGINE', 'Risk engine / auto-approval changes', '', '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "UatTemplate" (code, title, steps, "expectedResults", "evidenceRequired", "createdAt", "updatedAt") VALUES ('UAT-COLLATERAL', 'Collateral management changes', '', '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "UatTemplate" (code, title, steps, "expectedResults", "evidenceRequired", "createdAt", "updatedAt") VALUES ('UAT-BANK', 'Bank integration changes', '', '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "UatTemplate" (code, title, steps, "expectedResults", "evidenceRequired", "createdAt", "updatedAt") VALUES ('UAT-TRAVEL-RULE', 'Travel rule changes', '', '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "UatTemplate" (code, title, steps, "expectedResults", "evidenceRequired", "createdAt", "updatedAt") VALUES ('UAT-CUSTODY-API', 'Custody API changes', '', '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "UatTemplate" (code, title, steps, "expectedResults", "evidenceRequired", "createdAt", "updatedAt") VALUES ('UAT-FEES', 'Fee management changes', '', '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "UatTemplate" (code, title, steps, "expectedResults", "evidenceRequired", "createdAt", "updatedAt") VALUES ('UAT-ANALYTICS', 'Analytics view changes (MTD / inbound reports)', '', '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "UatTemplate" (code, title, steps, "expectedResults", "evidenceRequired", "createdAt", "updatedAt") VALUES ('UAT-PERMISSIONS', 'Permission changes (access review)', '', '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "UatTemplate" (code, title, steps, "expectedResults", "evidenceRequired", "createdAt", "updatedAt") VALUES ('UAT-VERIFY-FIX', 'Verify fix for a ticket raised by Transaction Operations', '', '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "UatTemplate" (code, title, steps, "expectedResults", "evidenceRequired", "createdAt", "updatedAt") VALUES ('UAT-CLIENT-AWARENESS', 'Client-facing change (awareness)', '', '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "UatTemplate" (code, title, steps, "expectedResults", "evidenceRequired", "createdAt", "updatedAt") VALUES ('UAT-GENERAL', 'General change', '', '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

COMMIT;
