-- Spec §8: integration snapshots, status mapping, Jira project config,
-- Jira issue history, Slack channel purpose/client.

-- AlterTable
ALTER TABLE "SlackChannel" ADD COLUMN IF NOT EXISTS "clientId" TEXT,
ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'internal_ops';

-- Backfill channel purpose from the legacy channelType.
UPDATE "SlackChannel" SET "purpose" = CASE "channelType"
  WHEN 'client' THEN 'client'
  WHEN 'service_provider' THEN 'vendor'
  ELSE 'internal_ops' END
WHERE "purpose" = 'internal_ops';

-- CreateTable
CREATE TABLE IF NOT EXISTS "SourceRecord" (
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
CREATE TABLE IF NOT EXISTS "SettlementStatusMap" (
    "entity" TEXT NOT NULL,
    "raw" TEXT NOT NULL,
    "mapped" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementStatusMap_pkey" PRIMARY KEY ("entity","raw")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "JiraProjectConfig" (
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
CREATE TABLE IF NOT EXISTS "JiraIssueEvent" (
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

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SourceRecord_source_kind_status_idx" ON "SourceRecord"("source", "kind", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SourceRecord_kind_mappedStatus_idx" ON "SourceRecord"("kind", "mappedStatus");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SourceRecord_lastSeenAt_idx" ON "SourceRecord"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SourceRecord_source_kind_externalId_key" ON "SourceRecord"("source", "kind", "externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "JiraProjectConfig_enabled_idx" ON "JiraProjectConfig"("enabled");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "JiraIssueEvent_key_idx" ON "JiraIssueEvent"("key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "JiraIssueEvent_workItemId_idx" ON "JiraIssueEvent"("workItemId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "JiraIssueEvent_system_key_updated_key" ON "JiraIssueEvent"("system", "key", "updated");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SlackChannel_clientId_idx" ON "SlackChannel"("clientId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SlackChannel_purpose_isActive_idx" ON "SlackChannel"("purpose", "isActive");

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "SlackChannel" ADD CONSTRAINT "SlackChannel_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Spec §8.3 projects. All disabled: an admin enables each after the runtime
-- discovery of issue types and transitions has been checked. Nothing else is
-- hard-coded (issue type ids, transition ids, custom field ids are discovered).
INSERT INTO "JiraProjectConfig" ("key", "name", "purpose", "defaultWorkItemKind", "defaultTeam", "defaultTaskCode", "syncInbound", "updatedAt") VALUES
  ('OTC', 'Operation Transaction Changes', 'MTD breaks, EOD balance requests, internal transaction uploads, voids (reconciliation and ticketing only)', 'internal_task', 'All', 'JIRA-OTC', true, CURRENT_TIMESTAMP),
  ('TOPS', 'Transaction Operations', 'Daily task tickets', 'internal_task', 'All', 'JIRA-TOPS', true, CURRENT_TIMESTAMP),
  ('VSR', 'Vendor service requests', 'Vendor RCA and issue tickets', 'vendor_ticket', 'All', 'JIRA-VSR', true, CURRENT_TIMESTAMP),
  ('GXS', 'GX Service Management', 'GX issues raised by the team', 'internal_task', 'All', 'JIRA-GXS', true, CURRENT_TIMESTAMP),
  ('IAI', 'Issues and Incidents Log', 'Incidents (shared with other departments)', 'incident', 'All', 'JIRA-IAI', true, CURRENT_TIMESTAMP),
  ('KPR', 'Police realisations', 'KPS K4 realisation and K3 return of assets', 'kps_case', 'All', 'JIRA-KPR', true, CURRENT_TIMESTAMP),
  ('TOKENS', 'Token Listing', 'Coin reviews', 'coin_review', 'All', 'JIRA-TOKENS', true, CURRENT_TIMESTAMP),
  ('FOA', 'Finance Ops Approvals', 'Billing and fee approvals (visibility only)', 'internal_task', 'All', 'JIRA-FOA', false, CURRENT_TIMESTAMP),
  ('AO', 'Admin Operations', 'Cross-team items (visibility only)', 'internal_task', 'All', 'JIRA-AO', false, CURRENT_TIMESTAMP),
  ('ITR', 'ITR', 'TODO(CONFIRM-PROJECT-ROLES): confirm purpose before enabling', 'internal_task', 'All', 'JIRA-ITR', false, CURRENT_TIMESTAMP),
  ('RCM', 'RCM', 'TODO(CONFIRM-PROJECT-ROLES): confirm purpose before enabling', 'internal_task', 'All', 'JIRA-RCM', false, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
