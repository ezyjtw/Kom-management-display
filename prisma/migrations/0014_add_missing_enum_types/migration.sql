-- CreateEnum: ThreadStatus
CREATE TYPE "ThreadStatus" AS ENUM ('Unassigned', 'Assigned', 'InProgress', 'WaitingExternal', 'WaitingInternal', 'PendingHandover', 'Done', 'Closed');

-- CreateEnum: ThreadPriority
CREATE TYPE "ThreadPriority" AS ENUM ('P0', 'P1', 'P2', 'P3');

-- CreateEnum: AlertSeverity
CREATE TYPE "AlertSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum: AlertStatus
CREATE TYPE "AlertStatus" AS ENUM ('active', 'acknowledged', 'resolved');

-- CreateEnum: TravelRuleCaseStatus
CREATE TYPE "TravelRuleCaseStatus" AS ENUM ('Open', 'Investigating', 'PendingResponse', 'Resolved', 'Escalated');

-- CreateEnum: TravelRuleResolutionType
CREATE TYPE "TravelRuleResolutionType" AS ENUM ('info_obtained', 'email_sent', 'not_required', 'escalated');

-- CreateEnum: ProjectStatus
CREATE TYPE "ProjectStatus" AS ENUM ('planned', 'active', 'on_hold', 'completed', 'cancelled');

-- CreateEnum: DailyCheckStatus
CREATE TYPE "DailyCheckStatus" AS ENUM ('pending', 'pass', 'issues_found', 'skipped');

-- CreateEnum: IncidentSeverity
CREATE TYPE "IncidentSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum: IncidentStatus
CREATE TYPE "IncidentStatus" AS ENUM ('active', 'monitoring', 'resolved');

-- CreateEnum: CommsSource
CREATE TYPE "CommsSource" AS ENUM ('email', 'slack', 'jira', 'manual');

-- CreateEnum: UserRole
CREATE TYPE "UserRole" AS ENUM ('admin', 'lead', 'employee', 'auditor');

-- CreateEnum: EmployeeRole
CREATE TYPE "EmployeeRole" AS ENUM ('Analyst', 'Senior', 'Lead', 'Manager');

-- CreateEnum: TeamName
CREATE TYPE "TeamName" AS ENUM ('TransactionOperations', 'AdminOperations', 'DataOperations', 'StakingOps', 'Settlements');

-- CreateEnum: Region
CREATE TYPE "Region" AS ENUM ('Global', 'EMEA', 'APAC', 'Americas');

-- CreateEnum: TimePeriodType
CREATE TYPE "TimePeriodType" AS ENUM ('week', 'month', 'quarter');

-- CreateEnum: ScoreCategory
CREATE TYPE "ScoreCategory" AS ENUM ('daily_tasks', 'projects', 'asset_actions', 'quality', 'knowledge');

-- CreateEnum: TransactionRiskLevel
CREATE TYPE "TransactionRiskLevel" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum: ConfirmationStatus
CREATE TYPE "ConfirmationStatus" AS ENUM ('pending', 'acknowledged', 'signed_off', 'escalated', 'expired');

-- CreateEnum: JobStatus
CREATE TYPE "JobStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'retrying');

-- AlterTable: CommsThread — convert TEXT columns to enum types
ALTER TABLE "CommsThread" ALTER COLUMN "status" TYPE "ThreadStatus" USING "status"::"ThreadStatus";
ALTER TABLE "CommsThread" ALTER COLUMN "priority" TYPE "ThreadPriority" USING "priority"::"ThreadPriority";
ALTER TABLE "CommsThread" ALTER COLUMN "source" TYPE "CommsSource" USING "source"::"CommsSource";

-- AlterTable: Alert — convert TEXT columns to enum types
ALTER TABLE "Alert" ALTER COLUMN "severity" TYPE "AlertSeverity" USING "severity"::"AlertSeverity";
ALTER TABLE "Alert" ALTER COLUMN "status" TYPE "AlertStatus" USING "status"::"AlertStatus";

-- AlterTable: TravelRuleCase — convert TEXT columns to enum types
ALTER TABLE "TravelRuleCase" ALTER COLUMN "status" TYPE "TravelRuleCaseStatus" USING "status"::"TravelRuleCaseStatus";
ALTER TABLE "TravelRuleCase" ALTER COLUMN "resolutionType" TYPE "TravelRuleResolutionType" USING CASE WHEN "resolutionType" IS NOT NULL THEN "resolutionType"::"TravelRuleResolutionType" ELSE NULL END;

-- AlterTable: Project — convert TEXT column to enum type
ALTER TABLE "Project" ALTER COLUMN "status" TYPE "ProjectStatus" USING "status"::"ProjectStatus";

-- AlterTable: DailyCheckItem — convert TEXT column to enum type
ALTER TABLE "DailyCheckItem" ALTER COLUMN "status" TYPE "DailyCheckStatus" USING "status"::"DailyCheckStatus";

-- AlterTable: Incident — convert TEXT columns to enum types
ALTER TABLE "Incident" ALTER COLUMN "severity" TYPE "IncidentSeverity" USING "severity"::"IncidentSeverity";
ALTER TABLE "Incident" ALTER COLUMN "status" TYPE "IncidentStatus" USING "status"::"IncidentStatus";

-- AlterTable: User — convert TEXT column to enum type
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole" USING "role"::"UserRole";

-- AlterTable: Employee — convert TEXT columns to enum types
ALTER TABLE "Employee" ALTER COLUMN "role" TYPE "EmployeeRole" USING "role"::"EmployeeRole";
ALTER TABLE "Employee" ALTER COLUMN "team" TYPE "TeamName" USING "team"::"TeamName";
ALTER TABLE "Employee" ALTER COLUMN "region" TYPE "Region" USING "region"::"Region";

-- AlterTable: TimePeriod — convert TEXT column to enum type
ALTER TABLE "TimePeriod" ALTER COLUMN "type" TYPE "TimePeriodType" USING "type"::"TimePeriodType";

-- AlterTable: CategoryScore — convert TEXT column to enum type
ALTER TABLE "CategoryScore" ALTER COLUMN "category" TYPE "ScoreCategory" USING "category"::"ScoreCategory";

-- AlterTable: TransactionConfirmation — convert TEXT columns to enum types
ALTER TABLE "TransactionConfirmation" ALTER COLUMN "riskLevel" TYPE "TransactionRiskLevel" USING "riskLevel"::"TransactionRiskLevel";
ALTER TABLE "TransactionConfirmation" ALTER COLUMN "status" TYPE "ConfirmationStatus" USING "status"::"ConfirmationStatus";

-- AlterTable: BackgroundJob — convert TEXT column to enum type
ALTER TABLE "BackgroundJob" ALTER COLUMN "status" TYPE "JobStatus" USING "status"::"JobStatus";
