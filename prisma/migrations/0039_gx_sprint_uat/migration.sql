-- Phase 11 (spec §16): GX sprint change intake and UAT tickets.

ALTER TYPE "WorkItemKind" ADD VALUE IF NOT EXISTS 'uat_task';

CREATE TABLE "GxSprint" (
    "id" TEXT NOT NULL,
    "sprint" TEXT NOT NULL,
    "releaseNotesUrl" TEXT NOT NULL DEFAULT '',
    "releaseNotesPageId" TEXT,
    "pageVersion" INTEGER NOT NULL DEFAULT 0,
    "uatLandedAt" TIMESTAMP(3),
    "prodPlannedAt" TIMESTAMP(3),
    "kmncKeys" JSONB NOT NULL DEFAULT '[]',
    "fixVersions" JSONB NOT NULL DEFAULT '[]',
    "parentTicketKey" TEXT,
    "parentWorkItemId" TEXT,
    "lastParsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GxSprint_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GxSprint_sprint_key" ON "GxSprint"("sprint");

CREATE TABLE "GxChange" (
    "id" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "gxJiraKeys" JSONB NOT NULL DEFAULT '[]',
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
    CONSTRAINT "GxChange_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GxChange_sprintId_section_rowHash_key" ON "GxChange"("sprintId", "section", "rowHash");
CREATE INDEX "GxChange_sprintId_removedAt_idx" ON "GxChange"("sprintId", "removedAt");
ALTER TABLE "GxChange" ADD CONSTRAINT "GxChange_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "GxSprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "GxImpactRule" (
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
    CONSTRAINT "GxImpactRule_pkey" PRIMARY KEY ("id")
);

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

-- Seed impact mapping from spec §16.3, INACTIVE until the team has reviewed it (TODO(CONFIRM-GX-IMPACT-RULES)).
INSERT INTO "GxImpactRule" ("id","name","matchOn","pattern","taskCodes","alertCodes","controls","team","uatTemplate","priority","isActive","updatedAt") VALUES
  ('gxr_staking_ws', 'Staking workstream', 'workstream', '^staking$', '["CHK-16", "CHK-17", "CHK-21", "CHK-22"]', '[]', '["5.1", "5.2", "5.3"]', 'Team 3', 'UAT-STAKING', 'P2', false, CURRENT_TIMESTAMP),
  ('gxr_staking_sec', 'Stake / Unstake section', 'section', 'stake\s*/\s*unstake', '["CHK-16", "CHK-17", "CHK-21", "CHK-22"]', '[]', '["5.1", "5.2", "5.3"]', 'Team 3', 'UAT-STAKING', 'P2', false, CURRENT_TIMESTAMP),
  ('gxr_risk_ws', 'Tx Automation workstream', 'workstream', 'tx automation', '["TASK-RISKVIEW"]', '["ALR-RSK-*"]', '["3.2", "3.3"]', 'All', 'UAT-RISK-ENGINE', 'P1', false, CURRENT_TIMESTAMP),
  ('gxr_risk_sec', 'Risk Engine section', 'section', 'risk engine', '["TASK-RISKVIEW"]', '["ALR-RSK-*"]', '["3.2", "3.3"]', 'All', 'UAT-RISK-ENGINE', 'P1', false, CURRENT_TIMESTAMP),
  ('gxr_collateral', 'Collateral Management workstream', 'workstream', 'collateral management', '["CHK-10"]', '["ALR-OES-*"]', '[]', 'Team 1', 'UAT-COLLATERAL', 'P2', false, CURRENT_TIMESTAMP),
  ('gxr_fab', 'FAB Integration workstream', 'workstream', 'fab integration', '["TASK-FAB"]', '["ALR-FAB-*"]', '[]', 'Team 1', 'UAT-FAB', 'P2', false, CURRENT_TIMESTAMP),
  ('gxr_travel_rule', 'Travel Rule workstream', 'workstream', 'travel rule', '["CHK-09"]', '["ALR-TR-01"]', '[]', 'Team 3', 'UAT-TRAVEL-RULE', 'P2', false, CURRENT_TIMESTAMP),
  ('gxr_api_ws', 'Komainu API workstream', 'workstream', 'komainu api', '["KOMMAND-CONNECTOR"]', '["ALR-HB-*", "ALR-CFG-02"]', '[]', 'Head of Transaction Operations', 'UAT-KOMAINU-API', 'P2', false, CURRENT_TIMESTAMP),
  ('gxr_api_sec', 'New API section', 'section', 'new api', '["KOMMAND-CONNECTOR"]', '["ALR-HB-*", "ALR-CFG-02"]', '[]', 'Head of Transaction Operations', 'UAT-KOMAINU-API', 'P2', false, CURRENT_TIMESTAMP),
  ('gxr_fees', 'Fee Management workstream', 'workstream', 'fee management', '["TASK-FAB", "TASK-BILL"]', '["ALR-FAB-08"]', '[]', 'Team 1', 'UAT-FEES', 'P2', false, CURRENT_TIMESTAMP),
  ('gxr_analytics', 'Analytics views (deployment notes)', 'keyword', 'analytics\.|\brenamed?\b|\bviews?\b', '["CHK-02", "CHK-05"]', '[]', '["4.2"]', 'Team 2', 'UAT-ANALYTICS', 'P2', false, CURRENT_TIMESTAMP),
  ('gxr_permissions', 'Changes in Permission section', 'section', 'changes in permission', '["ACCESS-REVIEW"]', '[]', '[]', 'Head of Transaction Operations', 'UAT-PERMISSIONS', 'P2', false, CURRENT_TIMESTAMP),
  ('gxr_client_ui', 'Client UI / on-boarding workstream', 'workstream', 'client ui|client on-?boarding', '["CLIENT-AWARENESS"]', '[]', '[]', 'All', 'UAT-CLIENT-AWARENESS', 'P3', false, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- UAT test outlines are human-authored: seeded EMPTY, one per mapping row (spec §16.5).
INSERT INTO "UatTemplate" ("code","title","updatedAt") VALUES
  ('UAT-STAKING', 'Staking changes', CURRENT_TIMESTAMP),
  ('UAT-RISK-ENGINE', 'Risk engine / auto-approval changes', CURRENT_TIMESTAMP),
  ('UAT-COLLATERAL', 'Collateral management changes', CURRENT_TIMESTAMP),
  ('UAT-FAB', 'FAB integration changes', CURRENT_TIMESTAMP),
  ('UAT-TRAVEL-RULE', 'Travel rule changes', CURRENT_TIMESTAMP),
  ('UAT-KOMAINU-API', 'Komainu API changes', CURRENT_TIMESTAMP),
  ('UAT-FEES', 'Fee management changes', CURRENT_TIMESTAMP),
  ('UAT-ANALYTICS', 'Analytics view changes (MTD / inbound reports)', CURRENT_TIMESTAMP),
  ('UAT-PERMISSIONS', 'Permission changes (access review)', CURRENT_TIMESTAMP),
  ('UAT-VERIFY-FIX', 'Verify fix for a ticket raised by Transaction Operations', CURRENT_TIMESTAMP),
  ('UAT-CLIENT-AWARENESS', 'Client-facing change (awareness)', CURRENT_TIMESTAMP),
  ('UAT-GENERAL', 'General change', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
