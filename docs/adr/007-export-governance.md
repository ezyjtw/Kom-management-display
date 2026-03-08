# ADR-007: Export Governance

## Status
Accepted

## Context
Performance data, operational metrics, and compliance data can be exported. Exports need governance to prevent unauthorized data exfiltration and maintain audit trail.

## Decision
Implement **role-scoped exports** with **audit trail** and **sensitivity controls**.

## Controls
1. **Role restrictions**: Only admin and lead can export. Employees cannot export.
2. **Scope enforcement**: Leads can only export their team's data.
3. **Audit logging**: Every export is logged with user, format, scope, row count, timestamp.
4. **Watermarking**: CSV/JSON exports include generation metadata (timestamp, user, scope).
5. **Row limits**: Maximum 10,000 rows per export to prevent bulk extraction.
6. **Format support**: CSV for spreadsheets, JSON for programmatic use.

## Future Considerations
- Approval workflow for sensitive export types
- DLP integration
- Export frequency limits
- Field-level exclusion for PII
