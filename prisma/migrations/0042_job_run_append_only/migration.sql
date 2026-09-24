-- Phase 12 (review): BackgroundJobRun is execution evidence. One row per
-- attempt, written once. Updates and TRUNCATE are rejected; DELETE is allowed
-- only past the retention floor pruneJobRuns uses (30 days for succeeded runs,
-- 400 days for anything else), so failures and dead letters cannot be removed
-- early. TODO(CONFIRM-DB-ROLES): the app role also loses UPDATE/TRUNCATE by grant
-- (docs/phase1/db-roles.sql).
CREATE OR REPLACE FUNCTION kom_job_run_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
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

CREATE TRIGGER "BackgroundJobRun_append_only" BEFORE UPDATE OR DELETE ON "BackgroundJobRun"
  FOR EACH ROW EXECUTE FUNCTION kom_job_run_append_only();

CREATE OR REPLACE FUNCTION kom_job_run_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'BackgroundJobRun cannot be truncated' USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "BackgroundJobRun_no_truncate" BEFORE TRUNCATE ON "BackgroundJobRun"
  FOR EACH STATEMENT EXECUTE FUNCTION kom_job_run_no_truncate();
