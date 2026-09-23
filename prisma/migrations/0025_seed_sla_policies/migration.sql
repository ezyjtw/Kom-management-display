-- Spec §7.3. Seed SLA policies. Targets are CONFIRM-SLA-TARGETS and stay NULL
-- (the UI shows "SLA targets not set") until an admin sets them. The two known
-- values are filled in:
--   * MTD break closure: T+1 = resolve by end of the next business day (UK);
--   * OES exchange contact: within 120 minutes of the settlement window start
--     (WorkItem.clockStartedAt is the window start).
-- Idempotent: existing policies are never overwritten.
INSERT INTO "SlaPolicy" ("id", "code", "description", "ownershipMins", "firstRespMins", "resolveMins", "resolveRule", "calendar", "createdAt", "updatedAt") VALUES
  ('slapol_client_q_p0', 'CLIENT-Q-P0', 'Client question, priority P0', NULL, NULL, NULL, NULL, '24x7', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('slapol_client_q_p1', 'CLIENT-Q-P1', 'Client question, priority P1', NULL, NULL, NULL, NULL, '24x7', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('slapol_client_q_p2', 'CLIENT-Q-P2', 'Client question, priority P2', NULL, NULL, NULL, NULL, '24x7', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('slapol_client_q_p3', 'CLIENT-Q-P3', 'Client question, priority P3', NULL, NULL, NULL, NULL, '24x7', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('slapol_oes_fail', 'OES-FAIL', 'OES settlement failure: exchange contacted within 120 minutes of the settlement window start', NULL, 120, NULL, NULL, '24x7', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('slapol_fab_ack', 'FAB-ACK', 'FAB instruction acknowledged (CONFIRM-FAB-ACK-MINS)', NULL, NULL, NULL, NULL, '24x7', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('slapol_mtd_break', 'MTD-BREAK', 'MTD break closed T+1: by end of the next business day after reporting', NULL, NULL, NULL, 'next_business_day_eod', 'business_uk', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
