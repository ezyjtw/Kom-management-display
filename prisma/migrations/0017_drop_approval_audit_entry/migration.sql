-- Phase 0 (H1): stop using ApprovalAuditEntry. Archive rather than drop so
-- historical audit evidence is preserved.
ALTER TABLE "ApprovalAuditEntry" RENAME TO "_archived_approval_audit_entry";
ALTER TABLE "_archived_approval_audit_entry" RENAME CONSTRAINT "ApprovalAuditEntry_pkey" TO "_archived_approval_audit_entry_pkey";
ALTER INDEX "ApprovalAuditEntry_requestId_idx" RENAME TO "_archived_approval_audit_entry_requestId_idx";
ALTER INDEX "ApprovalAuditEntry_performedById_idx" RENAME TO "_archived_approval_audit_entry_performedById_idx";
