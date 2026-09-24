-- Spec v2: 24/7 five-minute polling (§6.1, §8.4, §8.5) and client incidents/risks with client JSM tickets (§9.7, H12).

ALTER TYPE "WorkItemKind" ADD VALUE IF NOT EXISTS 'client_incident';
ALTER TYPE "WorkItemKind" ADD VALUE IF NOT EXISTS 'client_risk';

ALTER TABLE "WorkItem" ADD COLUMN IF NOT EXISTS "clientTicketKey" TEXT;
ALTER TABLE "WorkItem" ADD COLUMN IF NOT EXISTS "clientTicketUrl" TEXT;
ALTER TABLE "WorkItem" ADD COLUMN IF NOT EXISTS "sourceMessageRef" TEXT;

CREATE TABLE IF NOT EXISTS "SyncCursor" (
    "source" TEXT NOT NULL,
    "cursor" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SyncCursor_pkey" PRIMARY KEY ("source")
);

CREATE TABLE IF NOT EXISTS "PollCycle" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    CONSTRAINT "PollCycle_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PollCycle_source_startedAt_idx" ON "PollCycle"("source", "startedAt");

CREATE TABLE IF NOT EXISTS "IncidentCategory" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "complianceSensitive" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IncidentCategory_pkey" PRIMARY KEY ("code")
);

CREATE TABLE IF NOT EXISTS "ClientUpdate" (
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
CREATE INDEX IF NOT EXISTS "ClientUpdate_workItemId_idx" ON "ClientUpdate"("workItemId");

CREATE TABLE IF NOT EXISTS "OutboundMessageDraft" (
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
CREATE INDEX IF NOT EXISTS "OutboundMessageDraft_workItemId_idx" ON "OutboundMessageDraft"("workItemId");

-- Seed categories (spec §9.7; TODO(CONFIRM-CATEGORY-LIST): Compliance to confirm the final list).
INSERT INTO "IncidentCategory" ("code", "label", "complianceSensitive", "sortOrder", "updatedAt") VALUES
  ('settlement_failure', 'Settlement failure', false, 10, CURRENT_TIMESTAMP),
  ('withdrawal_delay', 'Withdrawal delay', false, 20, CURRENT_TIMESTAMP),
  ('platform_issue', 'Platform issue', false, 30, CURRENT_TIMESTAMP),
  ('phishing_impersonation', 'Phishing or impersonation', false, 40, CURRENT_TIMESTAMP),
  ('account_compromise_suspected', 'Account compromise suspected', false, 50, CURRENT_TIMESTAMP),
  ('data_issue', 'Data issue', false, 60, CURRENT_TIMESTAMP),
  ('other', 'Other', false, 70, CURRENT_TIMESTAMP),
  ('kyt_alert', 'KYT alert', true, 100, CURRENT_TIMESTAMP),
  ('sanctions', 'Sanctions', true, 110, CURRENT_TIMESTAMP),
  ('suspected_financial_crime', 'Suspected financial crime', true, 120, CURRENT_TIMESTAMP),
  ('suspicious_activity', 'Suspicious activity', true, 130, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- Update-cadence SLA for client incidents (spec §9.7). Per-severity cadence lives on ALR-CLI-02 (CONFIRM-CLIENT-UPDATE-CADENCE).
INSERT INTO "SlaPolicy" ("id", "code", "description", "calendar", "createdAt", "updatedAt") VALUES
  ('slapol_client_incident_update', 'CLIENT-INCIDENT-UPDATE', 'Maximum time between client-visible updates while a client incident or risk is open', '24x7', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- The client-threshold review rule moves from ALR-CLI-01 to ALR-CLI-04: spec v2 assigns ALR-CLI-01..03 to §9.7.
UPDATE "AlertRule" SET "code" = 'ALR-CLI-04' WHERE "code" = 'ALR-CLI-01' AND NOT EXISTS (SELECT 1 FROM "AlertRule" WHERE "code" = 'ALR-CLI-04') AND "params" ? 'reviewMonths';
UPDATE "Alert" SET "ruleCode" = 'ALR-CLI-04', "type" = 'ALR-CLI-04' WHERE "ruleCode" = 'ALR-CLI-01' AND "message" LIKE 'Inbound threshold review overdue%';
