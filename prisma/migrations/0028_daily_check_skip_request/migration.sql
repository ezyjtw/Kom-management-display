-- Spec §10.2: skipping a daily check needs a second (lead/admin) approver.

-- AlterTable
ALTER TABLE "DailyCheckItem" ADD COLUMN IF NOT EXISTS "skipRequestedBy" TEXT;


-- Spec §10.3/§10.4 alert rules, seeded disabled like every rule (spec §11.1).
INSERT INTO "AlertRule" ("code", "enabled", "severity", "params", "route", "updatedAt") VALUES
  ('ALR-TKT-01', false, 'high', '{}', '{"businessHours":[],"outOfHours":[]}', CURRENT_TIMESTAMP),
  ('ALR-TKT-02', false, 'medium', '{}', '{"businessHours":[],"outOfHours":[]}', CURRENT_TIMESTAMP),
  ('ALR-IAI-01', false, 'high', '{}', '{"businessHours":["role:admin"],"outOfHours":["role:admin"]}', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
