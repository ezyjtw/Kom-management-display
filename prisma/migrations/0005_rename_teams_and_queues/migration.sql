-- Update default queue value
ALTER TABLE "CommsThread" ALTER COLUMN "queue" SET DEFAULT 'Transaction Operations';

-- Rename existing queue values
UPDATE "CommsThread" SET "queue" = 'Transaction Operations' WHERE "queue" = 'Ops';
UPDATE "CommsThread" SET "queue" = 'Admin Operations' WHERE "queue" = 'Settlements';
UPDATE "CommsThread" SET "queue" = 'Transaction Operations' WHERE "queue" = 'StakingOps';

-- Rename existing team values on employees
UPDATE "Employee" SET "team" = 'Transaction Operations' WHERE "team" = 'Ops';
UPDATE "Employee" SET "team" = 'Admin Operations' WHERE "team" = 'Settlements';
UPDATE "Employee" SET "team" = 'Data Operations' WHERE "team" = 'StakingOps';
