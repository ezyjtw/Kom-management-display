-- Phase 9 (spec §14.1): team membership for the work queue's "my team" filter.
ALTER TABLE "TeamConfig" ADD COLUMN "memberEmployeeIds" JSONB NOT NULL DEFAULT '[]';
