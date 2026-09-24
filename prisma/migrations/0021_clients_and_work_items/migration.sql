-- Spec §7.1–7.3, 7.7, 7.8: clients, the WorkItem queue, SLA policies/events,
-- time logs, ticket links and IAI drafts.

-- CreateEnum
DO $$ BEGIN CREATE TYPE "WorkItemKind" AS ENUM ('client_request', 'alert', 'daily_check_exception', 'mtd_break', 'oes_settlement', 'fab_instruction', 'kps_case', 'vendor_ticket', 'travel_rule_case', 'screening_case', 'scam_dust_case', 'coin_review', 'staking_exception', 'nft_review', 'report_task', 'incident', 'rca', 'internal_task'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN CREATE TYPE "WorkItemState" AS ENUM ('open', 'owned', 'waiting_client', 'waiting_vendor', 'waiting_internal', 'resolved', 'closed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Client" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "komainuOrgId" TEXT,
    "komainuAccountNos" JSONB NOT NULL DEFAULT '[]',
    "jsmOrganizationId" TEXT,
    "jurisdiction" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ClientChannel" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WorkItem" (
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
    "exposureUsd" DOUBLE PRECISION,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SlaPolicy" (
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
CREATE TABLE IF NOT EXISTS "SlaEvent" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlaEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TimeLog" (
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
CREATE TABLE IF NOT EXISTS "TicketLink" (
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
CREATE TABLE IF NOT EXISTS "IaiDraft" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "triggerCode" TEXT NOT NULL,
    "jiraKey" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IaiDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Client_komainuOrgId_key" ON "Client"("komainuOrgId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Client_jsmOrganizationId_key" ON "Client"("jsmOrganizationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Client_isActive_idx" ON "Client"("isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClientChannel_clientId_idx" ON "ClientChannel"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ClientChannel_kind_ref_key" ON "ClientChannel"("kind", "ref");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkItem_state_team_idx" ON "WorkItem"("state", "team");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkItem_clientId_idx" ON "WorkItem"("clientId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkItem_ticketKey_idx" ON "WorkItem"("ticketKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkItem_taskCode_state_idx" ON "WorkItem"("taskCode", "state");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkItem_ownerEmployeeId_idx" ON "WorkItem"("ownerEmployeeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkItem_slaPolicyId_idx" ON "WorkItem"("slaPolicyId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkItem_kind_state_idx" ON "WorkItem"("kind", "state");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WorkItem_sourceSystem_sourceId_key" ON "WorkItem"("sourceSystem", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SlaPolicy_code_key" ON "SlaPolicy"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SlaPolicy_isActive_idx" ON "SlaPolicy"("isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SlaEvent_workItemId_idx" ON "SlaEvent"("workItemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SlaEvent_kind_idx" ON "SlaEvent"("kind");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TimeLog_workItemId_idx" ON "TimeLog"("workItemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TimeLog_clientId_idx" ON "TimeLog"("clientId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TimeLog_loggedById_idx" ON "TimeLog"("loggedById");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TicketLink_workItemId_idx" ON "TicketLink"("workItemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TicketLink_system_key_idx" ON "TicketLink"("system", "key");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TicketLink_system_key_workItemId_key" ON "TicketLink"("system", "key", "workItemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "IaiDraft_workItemId_idx" ON "IaiDraft"("workItemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "IaiDraft_dueAt_completedAt_idx" ON "IaiDraft"("dueAt", "completedAt");

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "ClientChannel" ADD CONSTRAINT "ClientChannel_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_slaPolicyId_fkey" FOREIGN KEY ("slaPolicyId") REFERENCES "SlaPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "SlaEvent" ADD CONSTRAINT "SlaEvent_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "TimeLog" ADD CONSTRAINT "TimeLog_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "TimeLog" ADD CONSTRAINT "TimeLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "TimeLog" ADD CONSTRAINT "TimeLog_loggedById_fkey" FOREIGN KEY ("loggedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "TicketLink" ADD CONSTRAINT "TicketLink_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "IaiDraft" ADD CONSTRAINT "IaiDraft_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
