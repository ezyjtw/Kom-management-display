-- KOMmand Centre database roles (spec §17.7; review remediation).
-- TODO(CONFIRM-DB-ROLES): agree names and the managed-identity mapping with
-- Platform Security before applying to a shared environment.
--
-- Three roles:
--   kom_owner  owns the schema, the tables and the trigger functions. Used only
--              by the migration step (prisma migrate deploy). Not used at runtime.
--   kom_app    the web and worker runtime. Reads and writes business tables.
--              On AuditLog: SELECT and INSERT only. On BackgroundJobRun: SELECT,
--              INSERT and DELETE (the retention prune; the trigger still refuses
--              rows inside retention). No DDL, no TRUNCATE, no trigger changes.
--   kom_read   reporting and auditors: SELECT only.
--
-- With this in place the answer to "can the application change the audit log?"
-- is no, even with the application's own credentials: it has no UPDATE,
-- DELETE or TRUNCATE privilege, it cannot drop or disable the triggers (only
-- the owner can), and it cannot alter the trigger functions.
--
-- Run as a superuser or the database owner, once per environment, after the
-- first migration. Verified on PostgreSQL 16: as kom_app, INSERT into AuditLog
-- works; UPDATE, DELETE and TRUNCATE are refused (permission denied); dropping
-- or disabling the triggers is refused (must be owner); replacing the trigger
-- function and creating tables are refused; BackgroundJobRun rows can be
-- deleted only past retention; tables added by later migrations are usable. On Azure the login roles map to the workloads' managed
-- identities (kom_app for web and worker, kom_owner for the migration job).

-- 1. Roles (NOLOGIN group roles; grant them to the login principals)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kom_owner') THEN CREATE ROLE kom_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kom_app') THEN CREATE ROLE kom_app NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kom_read') THEN CREATE ROLE kom_read NOLOGIN; END IF;
END $$;

-- 2. Ownership: the schema objects belong to kom_owner.
ALTER SCHEMA public OWNER TO kom_owner;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO kom_owner', r.tablename);
  END LOOP;
  FOR r IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public' LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO kom_owner', r.sequence_name);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO kom_owner', r.fn);
  END LOOP;
END $$;

-- 3. No implicit rights for everyone.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM kom_app, kom_read;
GRANT USAGE ON SCHEMA public TO kom_app, kom_read;

-- 4. Runtime: DML on business tables, nothing more.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kom_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kom_app;

-- Evidence tables: append-only for the application.
REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM kom_app;
REVOKE UPDATE, TRUNCATE ON "BackgroundJobRun" FROM kom_app;
-- Prisma's migration history is the owner's business.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "_prisma_migrations" FROM kom_app;
-- Archived approval evidence (H1): read-only for everyone.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = '_archived_approval_audit_entry') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "_archived_approval_audit_entry" FROM kom_app;
  END IF;
END $$;

-- 5. Reporting and auditors.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO kom_read;

-- 6. Tables created by later migrations (run by kom_owner) get the same rights.
ALTER DEFAULT PRIVILEGES FOR ROLE kom_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kom_app;
ALTER DEFAULT PRIVILEGES FOR ROLE kom_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO kom_app;
ALTER DEFAULT PRIVILEGES FOR ROLE kom_owner IN SCHEMA public GRANT SELECT ON TABLES TO kom_read;
-- A new evidence table must revoke UPDATE/DELETE/TRUNCATE from kom_app in its own
-- migration; test audit-log-is-append-only checks AuditLog and BackgroundJobRun.

-- 7. Login principals (examples; on Azure these are the managed identities):
--   CREATE ROLE "kom-web" LOGIN;     GRANT kom_app  TO "kom-web";
--   CREATE ROLE "kom-worker" LOGIN;  GRANT kom_app  TO "kom-worker";
--   CREATE ROLE "kom-migrate" LOGIN; GRANT kom_owner TO "kom-migrate";
--   ALTER ROLE "kom-migrate" SET role = kom_owner;  -- new objects are owned by kom_owner
--   CREATE ROLE "kom-auditor" LOGIN; GRANT kom_read TO "kom-auditor";
