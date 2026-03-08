# Data Retention Policy

## Retention Periods by Data Class

| Data Class | Retention Period | Rationale | Disposal Method |
|------------|-----------------|-----------|-----------------|
| **Audit logs** | 7 years | Regulatory requirement (financial services compliance) | Archive to cold storage, then purge |
| **Travel rule cases** | 7 years | FATF Travel Rule regulatory requirement | Archive to cold storage, then purge |
| **Incidents** | 5 years | Operational risk management, RCA reference | Archive to cold storage, then purge |
| **Thread notes** | 3 years | Business continuity, dispute resolution | Purge |
| **Exports metadata** | 2 years | Audit trail for data access governance | Purge |
| **Alerts** | 1 year after resolution | Operational trend analysis | Purge |
| **Webhook events (raw)** | 90 days | Debugging and replay capability | Purge |
| **Session metadata** | 90 days | Security audit, login history | Purge |
| **Job queue entries** | 30 days after completion | Debugging failed integrations | Purge |
| **Rate limit entries** | 15 minutes (in-memory) | Sliding window, auto-evicted | In-memory eviction |

## Archive vs Purge Strategy

### Archive (cold storage)

Used for regulatory data that must be retained long-term but is rarely accessed.

1. Data is exported to compressed, encrypted files (JSON format)
2. Files are stored in cloud object storage (e.g., S3 with server-side encryption)
3. Archive metadata (date range, record count, checksum) is recorded in the audit log
4. Original database records are then deleted
5. Archives are immutable -- no modifications after creation

**Applicable to**: Audit logs, travel rule cases, incidents.

### Purge (hard delete)

Used for operational data that has no regulatory retention requirement.

1. Records older than the retention threshold are identified
2. Deletion is performed in batches (1000 records per batch) to avoid locking
3. Purge operations are logged in the audit trail
4. Cascade deletes remove related child records (e.g., thread notes with threads)

**Applicable to**: Thread notes, alerts, webhook events, session metadata, exports metadata, job queue entries.

## Retention Schedule

| Frequency | Action |
|-----------|--------|
| Daily | Purge expired job queue entries and rate limit data |
| Weekly | Purge expired webhook events and session metadata |
| Monthly | Purge expired alerts (resolved > 1 year) |
| Quarterly | Archive and purge thread notes older than 3 years |
| Annually | Archive and purge exports metadata older than 2 years |
| Annually | Archive incidents older than 5 years |
| Annually | Archive audit logs and travel rule cases older than 7 years |

## Compliance Considerations

### Regulatory Requirements

- **FATF Travel Rule**: Travel rule case data must be retained for a minimum of 7 years from case closure. This includes all associated notes, counterparty information, and transaction references.
- **Financial audit trail**: All audit logs (mutations, access events, exports) are retained for 7 years to satisfy financial services regulatory requirements.
- **Data subject requests**: If a data subject deletion request is received, regulatory data is exempt from deletion but must be flagged. Non-regulatory personal data should be anonymized rather than deleted where referential integrity requires it.

### Data Protection

- Archived data is encrypted at rest using AES-256
- Access to archives requires admin role and is logged
- Archives include checksums (SHA-256) for integrity verification
- No personal data is stored in archive filenames or metadata keys

### Backup Interaction

- Database backups follow a separate schedule (daily + monthly)
- Backup retention: 30 days for daily, 1 year for monthly
- Purged data may still exist in backups until backup expiry
- Restore operations must re-apply retention policies post-restore
