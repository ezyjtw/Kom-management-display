-- AuditLog.userId has a foreign key to Employee, but system-initiated actions
-- (auto-closure, SSO denials, retention jobs) audit as userId 'system'. Without
-- this row those writes fail. The actor is inactive and cannot sign in
-- (reserved .invalid domain; SSO requires an active Employee).
INSERT INTO "Employee" ("id", "name", "email", "role", "team", "region", "active", "createdAt", "updatedAt")
VALUES ('system', 'System', 'system@kommand.invalid', 'Analyst', 'TransactionOperations', 'Global', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
