-- Control integrity (review remediation).

-- 1. Durable job run history: one row per execution attempt, never reset.
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
CREATE INDEX "BackgroundJobRun_type_finishedAt_idx" ON "BackgroundJobRun"("type", "finishedAt");
CREATE INDEX "BackgroundJobRun_status_finishedAt_idx" ON "BackgroundJobRun"("status", "finishedAt");
CREATE INDEX "BackgroundJobRun_jobId_idx" ON "BackgroundJobRun"("jobId");

-- 2. Audit actor model. AuditLog.userId stays the Employee FK ("system" when the
--    actor has no Employee); the signed-in principal is actorUserId.
ALTER TABLE "AuditLog" ADD COLUMN "actorType" TEXT NOT NULL DEFAULT 'user';
ALTER TABLE "AuditLog" ADD COLUMN "actorUserId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "correlationId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "phase" TEXT NOT NULL DEFAULT 'recorded';
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");
CREATE INDEX "AuditLog_phase_createdAt_idx" ON "AuditLog"("phase", "createdAt");

-- details holds a JSON object, or a JSON string wrapping one; the column is TEXT in
-- databases created by migration 0001 (schema drift), so the helper takes text.
CREATE OR REPLACE FUNCTION kom_audit_details(d TEXT) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
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

-- Backfill before the table becomes append-only.
UPDATE "AuditLog" SET "actorUserId" = kom_audit_details("details"::text) -> 'metadata' ->> 'actorUserId'
  WHERE "actorUserId" IS NULL AND kom_audit_details("details"::text) -> 'metadata' ->> 'actorUserId' IS NOT NULL;
UPDATE "AuditLog" SET "actorType" = 'system' WHERE "userId" = 'system' AND "actorUserId" IS NULL;

-- Normalise the actor on every insert, whichever code path writes it: a User id in
-- "userId" becomes that user's Employee (or "system") with the User id kept in
-- "actorUserId". Anything that is neither an Employee nor a User still fails the FK.
CREATE OR REPLACE FUNCTION kom_audit_normalise_actor() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER "AuditLog_normalise_actor" BEFORE INSERT ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION kom_audit_normalise_actor();

-- 3. Append-only audit trail: rows can be inserted and read, never changed or removed.
--    TODO(CONFIRM-DB-ROLES): also run the application as a role without UPDATE/DELETE
--    on "AuditLog" and without ownership of these triggers (infrastructure).
CREATE OR REPLACE FUNCTION kom_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only (% rejected)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER "AuditLog_no_update_delete" BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION kom_audit_append_only();
CREATE TRIGGER "AuditLog_no_truncate" BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION kom_audit_append_only();
