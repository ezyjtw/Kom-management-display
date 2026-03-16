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

-- AlterTable: CommsThread — drop defaults, convert TEXT columns to enum types, restore defaults
ALTER TABLE "CommsThread" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "CommsThread" ALTER COLUMN "priority" DROP DEFAULT;
ALTER TABLE "CommsThread" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "CommsThread" ALTER COLUMN "status" TYPE "ThreadStatus" USING "status"::"ThreadStatus";
ALTER TABLE "CommsThread" ALTER COLUMN "priority" TYPE "ThreadPriority" USING "priority"::"ThreadPriority";
ALTER TABLE "CommsThread" ALTER COLUMN "source" TYPE "CommsSource" USING "source"::"CommsSource";
ALTER TABLE "CommsThread" ALTER COLUMN "status" SET DEFAULT 'Unassigned'::"ThreadStatus";
ALTER TABLE "CommsThread" ALTER COLUMN "priority" SET DEFAULT 'P2'::"ThreadPriority";
ALTER TABLE "CommsThread" ALTER COLUMN "source" SET DEFAULT 'email'::"CommsSource";

-- AlterTable: Alert — drop defaults, convert TEXT columns to enum types, restore defaults
ALTER TABLE "Alert" ALTER COLUMN "severity" DROP DEFAULT;
ALTER TABLE "Alert" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Alert" ALTER COLUMN "severity" TYPE "AlertSeverity" USING "severity"::"AlertSeverity";
ALTER TABLE "Alert" ALTER COLUMN "status" TYPE "AlertStatus" USING "status"::"AlertStatus";
ALTER TABLE "Alert" ALTER COLUMN "severity" SET DEFAULT 'medium'::"AlertSeverity";
ALTER TABLE "Alert" ALTER COLUMN "status" SET DEFAULT 'active'::"AlertStatus";

-- AlterTable: TravelRuleCase — drop default, convert TEXT columns to enum types, restore default
ALTER TABLE "TravelRuleCase" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "TravelRuleCase" ALTER COLUMN "status" TYPE "TravelRuleCaseStatus" USING "status"::"TravelRuleCaseStatus";
ALTER TABLE "TravelRuleCase" ALTER COLUMN "resolutionType" TYPE "TravelRuleResolutionType" USING CASE WHEN "resolutionType" IS NOT NULL THEN "resolutionType"::"TravelRuleResolutionType" ELSE NULL END;
ALTER TABLE "TravelRuleCase" ALTER COLUMN "status" SET DEFAULT 'Open'::"TravelRuleCaseStatus";

-- AlterTable: Project — drop default, convert TEXT column to enum type, restore default
ALTER TABLE "Project" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Project" ALTER COLUMN "status" TYPE "ProjectStatus" USING "status"::"ProjectStatus";
ALTER TABLE "Project" ALTER COLUMN "status" SET DEFAULT 'active'::"ProjectStatus";

-- AlterTable: DailyCheckItem — drop default, convert TEXT column to enum type, restore default
ALTER TABLE "DailyCheckItem" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "DailyCheckItem" ALTER COLUMN "status" TYPE "DailyCheckStatus" USING "status"::"DailyCheckStatus";
ALTER TABLE "DailyCheckItem" ALTER COLUMN "status" SET DEFAULT 'pending'::"DailyCheckStatus";

-- AlterTable: Incident — drop defaults, convert TEXT columns to enum types, restore defaults
ALTER TABLE "Incident" ALTER COLUMN "severity" DROP DEFAULT;
ALTER TABLE "Incident" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Incident" ALTER COLUMN "severity" TYPE "IncidentSeverity" USING "severity"::"IncidentSeverity";
ALTER TABLE "Incident" ALTER COLUMN "status" TYPE "IncidentStatus" USING "status"::"IncidentStatus";
ALTER TABLE "Incident" ALTER COLUMN "severity" SET DEFAULT 'medium'::"IncidentSeverity";
ALTER TABLE "Incident" ALTER COLUMN "status" SET DEFAULT 'active'::"IncidentStatus";

-- AlterTable: User — drop default, convert TEXT column to enum type, restore default
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole" USING "role"::"UserRole";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'employee'::"UserRole";

-- AlterTable: Employee — drop defaults, convert TEXT columns to enum types, restore defaults
ALTER TABLE "Employee" ALTER COLUMN "region" DROP DEFAULT;
ALTER TABLE "Employee" ALTER COLUMN "role" TYPE "EmployeeRole" USING "role"::"EmployeeRole";
ALTER TABLE "Employee" ALTER COLUMN "team" TYPE "TeamName" USING "team"::"TeamName";
ALTER TABLE "Employee" ALTER COLUMN "region" TYPE "Region" USING "region"::"Region";
ALTER TABLE "Employee" ALTER COLUMN "region" SET DEFAULT 'Global'::"Region";

-- AlterTable: TimePeriod — convert TEXT column to enum type (no default)
ALTER TABLE "TimePeriod" ALTER COLUMN "type" TYPE "TimePeriodType" USING "type"::"TimePeriodType";

-- AlterTable: CategoryScore — convert TEXT column to enum type (no default)
ALTER TABLE "CategoryScore" ALTER COLUMN "category" TYPE "ScoreCategory" USING "category"::"ScoreCategory";

-- AlterTable: TransactionConfirmation — drop defaults, convert TEXT columns to enum types, restore defaults
ALTER TABLE "TransactionConfirmation" ALTER COLUMN "riskLevel" DROP DEFAULT;
ALTER TABLE "TransactionConfirmation" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "TransactionConfirmation" ALTER COLUMN "riskLevel" TYPE "TransactionRiskLevel" USING "riskLevel"::"TransactionRiskLevel";
ALTER TABLE "TransactionConfirmation" ALTER COLUMN "status" TYPE "ConfirmationStatus" USING "status"::"ConfirmationStatus";
ALTER TABLE "TransactionConfirmation" ALTER COLUMN "riskLevel" SET DEFAULT 'medium'::"TransactionRiskLevel";
ALTER TABLE "TransactionConfirmation" ALTER COLUMN "status" SET DEFAULT 'pending'::"ConfirmationStatus";

-- AlterTable: BackgroundJob — drop default, convert TEXT column to enum type, restore default
ALTER TABLE "BackgroundJob" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "BackgroundJob" ALTER COLUMN "status" TYPE "JobStatus" USING "status"::"JobStatus";
ALTER TABLE "BackgroundJob" ALTER COLUMN "status" SET DEFAULT 'pending'::"JobStatus";
