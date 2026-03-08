# ADR-007: Export Governance

**Status:** Accepted
**Date:** 2026-03-08
**Decision Makers:** Platform Team

## Context

The platform handles sensitive financial and operational data. Exports
(CSV, JSON) create data copies outside the system's access controls.
Uncontrolled exports represent a significant data leakage risk.

## Decision

### Role-Based Export Restrictions

| Role | Row Limit | Exportable Resources | Scope |
|------|-----------|---------------------|-------|
| admin | 50,000 | All | All data |
| lead | 10,000 | employees, scores, threads, alerts | Team-scoped |
| employee | 0 | None | N/A |
| auditor | 50,000 | All | All data |

### Watermarking

Every export includes a watermark containing:
- Exporter name and user ID
- Export timestamp
- Resource type and row count

CSV exports include it as a comment header (`# Exported by ...`).
JSON exports include it in a `_watermark` field.

### Sensitive Field Masking

Non-admin exports automatically mask sensitive fields using the same
`SENSITIVE_FIELDS` definitions from the authorization matrix:
- Employee emails, wallet addresses, bank references, session tokens

The `fieldsRedacted` flag in the export result indicates whether masking was applied.

### Audit Trail

Every export creates an `AuditLog` entry with action, entity type, user ID,
format, row count, and watermark text. If audit logging fails, the export
still succeeds but includes `auditLogId: "audit_failed"`.

### Row Limits

- Role-based limits enforced server-side via Prisma `take`
- Role limit wins if request asks for more
- Requested amount used if below role limit

## Alternatives Considered

1. **No export feature:** Forces screenshots/manual copy — worse for audit.
2. **Approval workflow for all exports:** Too slow for routine lead exports.
   Planned as Phase 2 for sensitive/bulk exports.
3. **DLP integration:** Adds external dependency. Field-level masking is adequate.

## Consequences

- Employees cannot export any data — must escalate to a lead.
- All exports are traceable to the individual who generated them.
- Watermarks survive file sharing — embedded in the data itself.
- Row limits prevent full database dumps even by authorized exporters.

## Related

- `src/modules/export/services/export-service.ts` — Export implementation
- `src/app/api/export/route.ts` — Export API endpoint
- `src/__tests__/export-governance.test.ts` — Export governance tests
- ADR-003 — Authorization model (export resource permissions)
