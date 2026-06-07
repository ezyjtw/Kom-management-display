-- Add 'confluence' to CommsSource enum
ALTER TYPE "CommsSource" ADD VALUE IF NOT EXISTS 'confluence';

-- CreateTable: JiraIssueState
CREATE TABLE "JiraIssueState" (
    "id" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "issueId" TEXT NOT NULL DEFAULT '',
    "projectKey" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "jiraStatus" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'P2',
    "issueType" TEXT NOT NULL DEFAULT '',
    "assigneeEmail" TEXT,
    "assigneeName" TEXT,
    "reporterEmail" TEXT,
    "reporterName" TEXT,
    "labels" JSONB NOT NULL DEFAULT '[]',
    "resolvedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jiraCreatedAt" TIMESTAMP(3) NOT NULL,
    "jiraUpdatedAt" TIMESTAMP(3) NOT NULL,
    "threadId" TEXT,
    "employeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JiraIssueState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JiraIssueState_issueKey_key" ON "JiraIssueState"("issueKey");
CREATE INDEX "JiraIssueState_projectKey_idx" ON "JiraIssueState"("projectKey");
CREATE INDEX "JiraIssueState_status_idx" ON "JiraIssueState"("status");
CREATE INDEX "JiraIssueState_assigneeEmail_idx" ON "JiraIssueState"("assigneeEmail");
CREATE INDEX "JiraIssueState_employeeId_idx" ON "JiraIssueState"("employeeId");
CREATE INDEX "JiraIssueState_resolvedAt_idx" ON "JiraIssueState"("resolvedAt");
CREATE INDEX "JiraIssueState_jiraUpdatedAt_idx" ON "JiraIssueState"("jiraUpdatedAt");

-- CreateTable: ConfluencePageState
CREATE TABLE "ConfluencePageState" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "spaceKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'current',
    "authorEmail" TEXT,
    "authorName" TEXT,
    "lastEditorEmail" TEXT,
    "lastEditorName" TEXT,
    "labels" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdInConfluence" TIMESTAMP(3) NOT NULL,
    "updatedInConfluence" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "employeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfluencePageState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfluencePageState_pageId_key" ON "ConfluencePageState"("pageId");
CREATE INDEX "ConfluencePageState_spaceKey_idx" ON "ConfluencePageState"("spaceKey");
CREATE INDEX "ConfluencePageState_authorEmail_idx" ON "ConfluencePageState"("authorEmail");
CREATE INDEX "ConfluencePageState_employeeId_idx" ON "ConfluencePageState"("employeeId");
CREATE INDEX "ConfluencePageState_updatedInConfluence_idx" ON "ConfluencePageState"("updatedInConfluence");

-- CreateTable: IntegrationSyncCursor
CREATE TABLE "IntegrationSyncCursor" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "cursor" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationSyncCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationSyncCursor_source_scope_key" ON "IntegrationSyncCursor"("source", "scope");
