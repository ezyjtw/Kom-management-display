# Compliance & Audit Framework

## KOMmand Centre — Regulatory & Audit Readiness

**Document Owner**: Operations Engineering
**Classification**: Internal — Auditor Accessible
**Last Reviewed**: 2026-03-15
**Review Cadence**: Quarterly

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Regulatory Scope](#2-regulatory-scope)
3. [SOC 1 Type I & II Mapping](#3-soc-1-type-i--ii-mapping)
4. [SOC 2 Type I & II Mapping](#4-soc-2-type-i--ii-mapping)
5. [ISO 27001:2022 Controls Mapping](#5-iso-270012022-controls-mapping)
6. [ISO 27701 (Privacy) Mapping](#6-iso-27701-privacy-mapping)
7. [FCA Compliance](#7-fca-compliance)
8. [JFSC Compliance](#8-jfsc-compliance)
9. [VARA Compliance](#9-vara-compliance)
10. [MiCAR Compliance](#10-micar-compliance)
11. [MAS (Singapore) Preparedness](#11-mas-singapore-preparedness)
12. [Control Evidence Directory](#12-control-evidence-directory)
13. [Audit Trail Architecture](#13-audit-trail-architecture)
14. [Incident & Breach Response](#14-incident--breach-response)
15. [Change Management Controls](#15-change-management-controls)
16. [Third-Party Risk Management](#16-third-party-risk-management)
17. [Data Governance](#17-data-governance)
18. [Continuous Monitoring & Reporting](#18-continuous-monitoring--reporting)
19. [Gap Analysis & Remediation](#19-gap-analysis--remediation)

---

## 1. Executive Summary

KOMmand Centre is an internal operations platform used by a 10-person digital asset custody team operating across three jurisdictions (London, Singapore, Dubai). The platform manages:

- Client communications triage and SLA tracking
- Third-party provider incident management and RCA workflows
- Travel rule compliance case management
- Transaction screening and confirmation workflows
- Staking operations monitoring
- OES settlement reconciliation
- Employee performance scoring

This document maps KOMmand Centre's technical and operational controls to the requirements of SOC 1, SOC 2, ISO 27001/27701, and the regulatory frameworks of the FCA (UK), JFSC (Jersey), VARA (UAE), MiCAR (EU), and MAS (Singapore).

**Key Control Principles:**
- All mutations are audit-logged with user identity, timestamp, before/after state
- Role-based access control (RBAC) with four roles: Admin, Lead, Employee, Auditor
- Every API route enforces authentication and authorization checks
- All user input is validated with Zod schemas before processing
- External AI calls wrap untrusted content in safety tags
- Client communications require explicit two-step human approval before sending
- Data retention follows financial services regulatory minimums (7 years for audit/travel rule data)

---

## 2. Regulatory Scope

| Jurisdiction | Regulator | Licence Type | Applicable To |
|---|---|---|---|
| **UK** | FCA | Cryptoasset business registration | All UK operations, client onboarding, AML/CFT |
| **Jersey** | JFSC | Virtual currency exchange business | Jersey entity operations, AML/CFT Handbook |
| **UAE (Dubai)** | VARA | Virtual asset service provider licence | Dubai operations, VASP obligations |
| **EU** | Various NCAs | MiCAR CASP authorisation | EU operations, asset classification, white paper requirements |
| **Singapore** | MAS | Payment Services Act (DPT licence) | Singapore operations (preparation phase) |

---

## 3. SOC 1 Type I & II Mapping

SOC 1 examines controls relevant to user entities' financial reporting (ICFR). For a custody operations platform, relevant control objectives relate to transaction processing accuracy, completeness, and authorisation.

### 3.1 Control Objectives & Evidence

| Control Objective | Control Activity | KOMmand Centre Evidence | Type I (Design) | Type II (Operating) |
|---|---|---|---|---|
| **CO-1: Transaction processing is authorised** | Maker-checker workflow for settlements | `OesSettlement` model: `makerById`, `checkerById`, `makerAt`, `checkerAt` fields enforce dual approval. Settlement cannot complete without both maker and checker sign-off. | Schema enforces non-null constraints for completion. API route validates both fields before status transition. | AuditLog entries for `settlement_confirmed` show maker and checker are different users over the examination period. Query: `SELECT * FROM "AuditLog" WHERE action='settlement_confirmed'` |
| **CO-2: Transactions are recorded completely and accurately** | Transaction confirmation workflow | `TransactionConfirmation` model tracks every high-risk transaction with acknowledgment, sign-off, and escalation states. Expiry deadlines trigger automated alerts. | ConfirmationStatus enum enforces valid state machine. SSE `confirmation_expired` events fire for unacknowledged confirmations. | AuditLog for `confirmation_acknowledged`, `confirmation_signed_off` entries. Zero orphaned confirmations (all reach terminal state). |
| **CO-3: Data changes are authorised and tracked** | Immutable audit trail | Every mutation across all modules writes to `AuditLog` table with userId, action, entityType, entityId, and JSON details (before/after state). | `createAuditEntry()` called in every service mutation. Fire-and-forget pattern ensures audit writes never block primary operations. | Audit log completeness verified by CI gate. AuditLog row count for each mutation type > 0 over examination period. |
| **CO-4: Access to processing is restricted** | RBAC with team scoping | `AUTHORIZATION_MATRIX` defines per-role permissions for all 25+ resources. `applyScopeFilter()` restricts data visibility to team/own scope. | CI gate verifies all routes have `requireAuth()` guard. Authorization matrix reviewed in ADR-006. | Session metadata tracks login history. Failed auth attempts logged. Quarterly access review of user roles. |
| **CO-5: USDC on/off ramp accuracy** | Multi-step ramp workflow | `UsdcRampRequest` model tracks 7-step onramp and 6-step offramp workflows. Each step requires explicit operator action. SSI verification, KYC/AML checks, wallet whitelisting tracked as boolean gates. | Schema enforces sequential status transitions. Maker/checker fields prevent self-approval. | AuditLog for ramp status transitions. Reconciliation between custody wallet movements and ramp completion records. |

### 3.2 SOC 1 Type II Testing Procedures

For Type II examination, auditors should:

1. **Sample transaction confirmations**: Select 25+ `TransactionConfirmation` records. Verify each has `acknowledgedById` ≠ null and `signedOffById` ≠ null (or `escalatedById` for exceptions). Verify timestamps are sequential.
2. **Sample settlement records**: Select 25+ `OesSettlement` records with `status='completed'`. Verify `makerById` ≠ `checkerById`. Verify `makerAt` < `checkerAt`.
3. **Audit trail completeness**: For each sampled transaction, verify corresponding `AuditLog` entries exist with matching entityId and sequential timestamps.
4. **Access review**: Extract all `User` records with roles. Cross-reference with HR records to verify role assignments are appropriate. Verify terminated employees have no active sessions.

---

## 4. SOC 2 Type I & II Mapping

SOC 2 Trust Services Criteria: Security, Availability, Processing Integrity, Confidentiality, Privacy.

### 4.1 Security (Common Criteria)

| TSC | Control | Implementation | Evidence |
|---|---|---|---|
| **CC1.1** Control environment | Management commitment | ADR documents establish architectural principles. CLAUDE.md enforces security rules for all development. | 13 ADRs covering security, auth, audit, retention. Security rules enforced in CI pipeline. |
| **CC2.1** Information & communication | Internal communication channels | CommsThread and incident management provide structured communication. Alert system notifies relevant personnel. | Alert routing by role/team. SSE real-time notifications. Slack integration for urgent alerts. |
| **CC3.1** Risk assessment | Risk identification | AI-powered thread classification (urgencyScore 1-5). Vendor reliability scoring. Transaction risk levels (low/medium/high/critical). | ThreadClassification interface with confidence levels. VendorReliabilityScore computed quarterly. TransactionRiskLevel enum. |
| **CC5.1** Control activities | Logical access controls | NextAuth.js JWT sessions (24-hour expiry). bcrypt password hashing. RBAC with 4 roles and 25+ resources. IP and user-agent tracking in SessionMetadata. | `requireAuth()` enforced on every API route (CI-verified). `checkAuthorization()` with scope filtering. Session hardening via SessionMetadata model. |
| **CC5.2** Control activities | Input validation | Zod schema validation on every mutation endpoint. HTML stripping, Unicode normalisation, control character removal on all text inputs. | CI gate: all POST/PUT/PATCH routes must have `safeParse`. `sanitizeText()`, `sanitizeLine()`, `sanitizeEmail()` functions. |
| **CC6.1** Logical & physical access | Authentication | Credential-based auth with bcrypt hashing. JWT tokens with role/team claims. No default or shared credentials. | `auth-options.ts` CredentialsProvider. Password minimum 8 characters. Rate limiting on login (5 attempts). |
| **CC6.2** Logical & physical access | Role-based authorisation | AUTHORIZATION_MATRIX with granular permissions. Team scoping limits data visibility. Sensitive fields masked for non-admin roles. | `checkAuthorization()` called after `requireAuth()`. `SENSITIVE_FIELDS` map masks PII. `applyScopeFilter()` for data isolation. |
| **CC6.3** Logical & physical access | Access provisioning/deprovisioning | User creation restricted to admin role. Employee deactivation disables access. Session revocation capability. | `createUserSchema` Zod validation. `active` field on Employee model. `SessionMetadata.revokedAt` for session invalidation. |
| **CC7.1** System operations | Detection of anomalies | CircuitBreaker pattern for external service failures. SLA monitoring with automated breach detection. Staking reward heartbeat monitoring. | `CircuitBreaker` class with state transitions (closed/open/half_open). SLA deadline fields with `check_sla` background job. Staking `check_staking` job. |
| **CC7.2** System operations | Incident management | Structured incident model with severity levels, status transitions, RCA workflow, external ticket tracking, dispute management. | `Incident` model with 20+ fields. `incidentService` with lifecycle management. `ExternalTicketEvent` audit trail. |
| **CC7.3** System operations | Recovery procedures | Health check endpoints (liveness, readiness, dependencies). Background job retry with exponential backoff. Dead letter queue for failed jobs. | `/api/health/liveness`, `/api/health/readiness`, `/api/health/dependencies`. `failJob()` with backoff: 30s, 60s, 120s. Dead letter on max attempts. |
| **CC8.1** Change management | Change control | CI/CD pipeline with lint, typecheck, test, security audit, schema validation, Docker build stages. PR-based workflow. | `.github/workflows/ci.yml` with 6 pipeline stages. Security job with 9 automated checks. |
| **CC9.1** Risk mitigation | Vendor management | ServiceProvider model tracks third-party vendors. VendorReliabilityScore computed quarterly. Status page polling. ClientServiceDependency mapping. | ServiceProvider with statusPageUrl, contactEmail. Reliability scoring: incident count, resolution time, client impact, RCA rate, disputes. |

### 4.2 Availability

| TSC | Control | Implementation | Evidence |
|---|---|---|---|
| **A1.1** Availability commitments | SLA definitions | Thread SLA tracking: TTO (Time to Ownership), TTFA (Time to First Action), TSLA (Time Since Last Action) per priority level. | `ttoDeadline`, `ttfaDeadline`, `tslaDeadline` on CommsThread. `computeTtoDeadline()` by priority. `check_sla` job every minute. |
| **A1.2** Environmental protections | Health monitoring | Three health endpoints: liveness (app running), readiness (DB connected), dependencies (external services). Circuit breakers for all integrations. | Health endpoints return degraded status when circuit breakers trip. Background job monitoring via admin dashboard. |

### 4.3 Processing Integrity

| TSC | Control | Implementation | Evidence |
|---|---|---|---|
| **PI1.1** Processing accuracy | Input validation | Zod schemas with type coercion, range limits, enum validation. Request body validated before any business logic. | `validateBody()` helper returns structured error messages. CI gate ensures all mutation routes have validation. |
| **PI1.2** Processing completeness | Idempotent operations | Webhook deduplication via `WebhookEvent.@@unique([source, eventId])`. Job deduplication via `deduplicationKey`. Upsert patterns for data sync. | WebhookEvent model prevents duplicate processing. Background job deduplication prevents concurrent runs. |
| **PI1.3** Processing timeliness | SLA monitoring | Per-priority SLA deadlines. Automated breach detection. Real-time SSE notifications for SLA breaches. Background job scheduling with cron expressions. | `emitSLABreach()` SSE events. Alert creation on deadline breach. Dashboard shows SLA status in real-time. |

### 4.4 Confidentiality

| TSC | Control | Implementation | Evidence |
|---|---|---|---|
| **C1.1** Confidential information | Data classification | Sensitive fields identified per resource type. Masked in API responses for non-admin roles. Export watermarking with user identity. | `SENSITIVE_FIELDS` map in auth types. `maskSensitiveFields()` function. Export headers include exporter name, timestamp, row count. |
| **C1.2** Disposal of confidential data | Data retention | 7-year retention for regulatory data. Archival to encrypted cold storage before purge. Batch deletion (1000 records) to avoid lock contention. | `DataRetentionPolicy` model per entity type. Retention schedule: daily to annual cadence. AES-256 encryption for archives. |

### 4.5 Privacy

| TSC | Control | Implementation | Evidence |
|---|---|---|---|
| **P1.1** Privacy notice | Data subject awareness | Client contact preferences stored with explicit channel preferences. Timezone and business hours respected for communications. | `ClientContactPreference` model with preferredChannel, timezone, businessHours. |
| **P3.1** Collection limitation | Minimal data collection | Thread participants stored as structured data (name, email, role). No unnecessary PII collection. Slack messages sanitised before storage. | `sanitiseSlackMessage()` replaces user IDs with `[mention]`. Messages truncated at 4000 chars. |
| **P4.1** Use limitation | Purpose limitation | Data used only for operational management. AI calls pass only necessary fields. Active incident summaries exclude client names. | AI classifier receives only title, provider, affectedServices — no client names. `wrapUntrustedContent()` for safety boundaries. |
| **P6.1** Data quality | Accuracy | Data sync jobs with cursors prevent duplication. Upsert patterns maintain data integrity. Zod validation ensures data quality at input. | `syncCursor` on SlackChannel. `@@unique` constraints on sync identifiers. `safeParse` on all inputs. |

### 4.6 SOC 2 Type II Testing Procedures

1. **Access review period**: Select 3+ months. Verify all `User` role changes have corresponding `AuditLog` entries. Verify no `employee` role has admin-level access.
2. **Change management**: Review all commits in the examination period. Verify CI pipeline ran and passed for all merged PRs. Verify no `--no-verify` bypass in git history.
3. **Incident response**: Select 10+ `Incident` records. Verify status transitions follow valid paths. Verify RCA workflow was initiated for critical/high incidents. Verify `AuditLog` entries exist for each status change.
4. **Data retention**: Verify `DataRetentionPolicy` records exist for all entity types. Verify purge jobs are scheduled and executed per retention schedule.
5. **Availability**: Review health endpoint uptime over examination period. Review circuit breaker trip events and recovery times.

---

## 5. ISO 27001:2022 Controls Mapping

### Annex A Controls

| Control | Title | Implementation | Evidence |
|---|---|---|---|
| **A.5.1** | Policies for information security | ADR documents define security architecture. CLAUDE.md enforces security development rules. | 13 ADRs, security rules in CI pipeline |
| **A.5.2** | Information security roles | Four-role RBAC model (Admin, Lead, Employee, Auditor) with defined responsibilities. | AUTHORIZATION_MATRIX in `auth/types/index.ts` |
| **A.5.15** | Access control | Multi-layer access control: auth → authorisation → scope filtering → field masking. | `requireAuth()` → `checkAuthorization()` → `applyScopeFilter()` → `maskSensitiveFields()` |
| **A.5.16** | Identity management | Unique user accounts linked to employees. No shared credentials. Email-based identity. | `User` model with unique email. `Employee` 1:1 relation. |
| **A.5.17** | Authentication information | bcrypt password hashing. JWT session tokens with 24-hour expiry. | `auth-options.ts` CredentialsProvider with bcrypt.compare() |
| **A.5.23** | Information security for cloud services | Docker containerisation with non-root user. Railway PaaS deployment. Environment-based configuration. | `Dockerfile` with USER directive. `railway.toml` configuration. `.env.example` for secrets management. |
| **A.5.24** | Information security incident management | Structured incident model with severity, status, RCA, external ticket tracking, dispute management. | `Incident` model, `incidentService`, `ExternalTicketEvent`, alert routing |
| **A.5.28** | Collection of evidence | Immutable audit log. Webhook payload storage. Export watermarking. Session metadata. | `AuditLog` table, `WebhookEvent` raw payload retention, `SessionMetadata` |
| **A.5.29** | Information security during disruption | Health endpoints, circuit breakers, background job retry, dead letter queue. | `/api/health/*` endpoints, `CircuitBreaker` class, `failJob()` with retry/dead-letter |
| **A.5.30** | ICT readiness for business continuity | Multi-region team (London, Singapore, Dubai). Automated background jobs. Real-time SSE notifications. | 10-person team across 3 timezones. Background job queue with automatic retry. |
| **A.6.1** | Screening | Not directly in platform scope — HR process. Employee records track team, role, region. | `Employee` model with role, team, region fields |
| **A.7.7** | Clear desk and clear screen | Session timeout (24-hour JWT expiry). Session revocation capability. | `SessionMetadata.expiresAt`, `revokedAt` |
| **A.8.1** | User endpoint devices | Not directly in platform scope — endpoint security is infrastructure-level. | N/A — platform is web-based |
| **A.8.2** | Privileged access rights | Admin role restricted. Sensitive actions require dual control. Export governance with role-based limits. | `sensitive-actions.ts` registry. Admin-only user management. Export row limits per role. |
| **A.8.3** | Information access restriction | Team-scoped data access. Own-scoped for employees. Sensitive field masking. | `ScopeType`: all/team/own/none. `SENSITIVE_FIELDS` per resource. |
| **A.8.4** | Access to source code | Not directly in platform scope — Git access control at infrastructure level. | Git-based workflow with PR reviews |
| **A.8.5** | Secure authentication | bcrypt hashing, JWT tokens, session metadata tracking (IP, user-agent). | `auth-options.ts`, `SessionMetadata` model |
| **A.8.7** | Protection against malware | Input sanitisation (HTML stripping, control character removal). CSP headers. | `sanitize.ts`, `next.config.js` CSP headers |
| **A.8.8** | Management of technical vulnerabilities | npm audit in CI pipeline (critical blocks, high blocks for production deps). Reviewed exceptions in `.audit-exceptions.json`. | CI security job. Audit exceptions with review dates and mitigation notes. |
| **A.8.9** | Configuration management | Environment-based configuration. Feature flags for gradual rollout. Scoring config versioning with approval workflow. | `.env.example`, `FeatureFlag` model, `ScoringConfig` with draft→review→approved→active workflow |
| **A.8.15** | Logging | Structured JSON logging (production) / readable format (development). Request/response logging with latency. Security event logging. | `logger.ts` with level-based output. `logger.security()`, `logger.audit()`, `logger.integration()` |
| **A.8.16** | Monitoring activities | Real-time SSE event stream. SLA monitoring. Circuit breaker health. Background job status dashboard. | SSE events, `check_sla` job, `CircuitBreaker.getAllStatus()`, admin jobs dashboard |
| **A.8.24** | Use of cryptography | bcrypt for passwords. HTTPS enforcement via HSTS. AES-256 for archived data. SHA-256 checksums for archive integrity. | CSP with upgrade-insecure-requests. Retention policy specifies encryption standards. |
| **A.8.25** | Secure development lifecycle | CI pipeline with lint, typecheck, test, security audit, schema validation. Zod input validation. OWASP-aware sanitisation. | `.github/workflows/ci.yml`, `validation.ts`, `sanitize.ts` |
| **A.8.26** | Application security requirements | All routes require auth guards (CI-enforced). All mutations require Zod validation (CI-enforced). AI calls require safety wrappers (CI-enforced). | 3 CI quality gates in security job |
| **A.8.28** | Secure coding | No raw SQL (Prisma ORM). No `eval()`. CSP blocks unsafe-eval. Input sanitisation at API boundaries. | Prisma parameterised queries. CSP in next.config.js. sanitize.ts at API layer. |

---

## 6. ISO 27701 (Privacy) Mapping

| Control | Title | Implementation |
|---|---|---|
| **7.2.1** | Identify and document purpose | Platform purpose documented in PRODUCT_OVERVIEW.md. Data used solely for custody operations management. |
| **7.2.2** | Identify lawful basis | Legitimate interest (internal ops platform). No direct processing of end-customer personal data. Client contact preferences stored with consent implied by business relationship. |
| **7.3.1** | Determine and fulfil obligations to PII principals | Client contact preferences allow channel/timezone preferences. Data minimisation in AI calls (no client names in incident summaries). |
| **7.4.1** | Limit collection | Slack messages sanitised — user IDs replaced with [mention], URLs replaced with [link]. Messages truncated at 4000 chars. Only operational data collected. |
| **7.4.5** | PII de-identification and deletion | Retention policy with defined periods. Archive-before-purge for regulatory data. Anonymisation for non-regulatory data subject requests. |
| **7.5.1** | Transfer basis | No cross-border PII transfers in platform scope. Platform operates within corporate network. External integrations (Slack, Jira) are corporate-controlled. |

---

## 7. FCA Compliance

### 7.1 FCA Registration Requirements (MLRs 2017)

| Requirement | KOMmand Centre Control | Evidence |
|---|---|---|
| **Customer due diligence** | Travel rule case management tracks CDD requirements per transaction. Screening entries track AML/CFT checks. | `TravelRuleCase` model with matchStatus, resolution workflow. `ScreeningEntry` with complianceReviewStatus. |
| **Suspicious activity reporting** | Screening classification (legitimate/dust/scam). Compliance review workflow. AI-assisted risk classification. | `ScreeningEntry.classification` with reclassification audit trail. `classifyScreeningRisk()` AI function. |
| **Record keeping** | 7-year retention for audit logs and travel rule cases. Immutable audit trail. | `DataRetentionPolicy` with 7-year periods for regulatory data. `AuditLog` append-only model. |
| **Internal controls** | RBAC, dual control for settlements, maker-checker workflows, approval audit trail. | AUTHORIZATION_MATRIX, `OesSettlement` dual approval, `ApprovalAuditEntry` model. |
| **Risk assessment** | Transaction risk levels (low/medium/high/critical). AI-powered triage. Vendor reliability scoring. | `TransactionRiskLevel` enum. `suggestThreadPriority()`. `VendorReliabilityScore` model. |

### 7.2 FCA Financial Promotions

| Requirement | Control |
|---|---|
| Client communications require human approval | `ClientCommsDraft` model with two-step approval flow. AI drafts are suggestions only — never auto-sent. |
| Communications are recorded | Every sent communication creates `AuditLog` entry with clientNames, channels, incidentId, employeeId. |
| Complaints handling | CommsThread with SLA tracking. Escalation workflows. Priority-based response times. |

### 7.3 FCA Senior Managers & Certification Regime (SM&CR)

| Requirement | Control |
|---|---|
| Clear responsibilities | Employee model with role, team, region. Authorization matrix defines per-role permissions. |
| Audit trail of decisions | AuditLog captures who approved what, when. Settlement maker/checker identities recorded. |
| Training & competence | KnowledgeScore model tracks operational understanding, asset knowledge, compliance awareness, incident response. |

---

## 8. JFSC Compliance

### 8.1 JFSC AML/CFT Handbook

| Requirement | KOMmand Centre Control | Evidence |
|---|---|---|
| **Customer identification** | Client contact preferences with structured identity data. Travel rule case tracking for VASP counterparties. | `ClientContactPreference` with clientName, vaspDid, travelRuleContact. |
| **Ongoing monitoring** | Screening entries track transaction monitoring outcomes. SLA-driven case resolution. | `ScreeningEntry` model. Travel rule 48-hour SLA deadline. |
| **Record keeping** | 7-year retention for travel rule cases. Immutable audit log for all mutations. | Retention policy documented. AuditLog with 7-year retention. |
| **Suspicious activity reporting** | Screening classification workflow. Compliance review status tracking. Escalation paths. | `ScreeningEntry.complianceReviewStatus`. Alert system for compliance-relevant events. |
| **Governance** | RBAC with admin/lead/employee/auditor roles. Dual control for high-value operations. | AUTHORIZATION_MATRIX. Settlement maker-checker. Export governance with row limits. |

### 8.2 JFSC Sound Business Practice Policy

| Requirement | Control |
|---|---|
| Adequate systems and controls | Structured incident management. RCA workflow. Vendor reliability scoring. |
| Segregation of duties | Maker-checker for settlements. Different user for approval vs creation. Role-based access restrictions. |
| Business continuity | Multi-region team. Automated background jobs with retry. Health monitoring endpoints. Circuit breakers for graceful degradation. |

---

## 9. VARA Compliance

### 9.1 VARA Rulebook — VASP Obligations

| Requirement | KOMmand Centre Control | Evidence |
|---|---|---|
| **Technology governance** | ADR-based architecture documentation. CI/CD pipeline with security gates. Feature flag-based deployment. | 13 ADRs. CI pipeline with 6 stages. FeatureFlag model for controlled rollout. |
| **Cybersecurity** | CSP headers, HSTS, input sanitisation, bcrypt authentication, JWT sessions, session metadata tracking. | `next.config.js` security headers. `sanitize.ts`. `auth-options.ts`. `SessionMetadata` model. |
| **Transaction monitoring** | Real-time transaction confirmation workflow. Screening entry tracking. Risk-based prioritisation. | `TransactionConfirmation` model. `ScreeningEntry` model. `TransactionRiskLevel` enum. |
| **Record keeping** | 7-year audit trail. Structured logging. Webhook payload retention. Export watermarking. | `AuditLog`, `WebhookEvent`, `logger.ts`, export governance in ADR-013. |
| **Incident response** | Structured incident model with severity, status transitions, RCA workflow, automated detection. | `Incident` model with AI-powered detection (`detectionSource='ai_slack'`). StatusPageEvent correlation. |
| **Client asset protection** | Staking wallet monitoring. Balance variance detection. Settlement reconciliation. | `StakingWallet` with balance reconciliation fields. `OesSettlement` with matchStatus. |
| **Travel rule compliance** | FATF-compliant case management. Notabene integration. Counterparty VASP contact management. 48-hour resolution SLA. | `TravelRuleCase` model. `VaspContact` model. `TravelRuleCaseStatus` enum. |

### 9.2 VARA Market Conduct Rules

| Requirement | Control |
|---|---|
| Fair and transparent communications | Client comms drafting with mandatory human review. Two-step approval flow. No auto-sent messages. |
| Complaints management | SLA-tracked communication threads. Priority-based response times. Escalation workflows. |
| Conflict of interest | Audit trail of all decisions. Separation of maker and checker roles. Auditor role with read-only access. |

---

## 10. MiCAR Compliance

### 10.1 CASP (Crypto-Asset Service Provider) Requirements

| MiCAR Article | Requirement | KOMmand Centre Control |
|---|---|---|
| **Art. 59** | Organisational requirements | RBAC with clear role definitions. Segregation of duties via authorization matrix. Audit trail for all operational decisions. |
| **Art. 60** | Prudential safeguards | Staking wallet monitoring with balance variance detection. Settlement reconciliation. Transaction confirmation workflow. |
| **Art. 61** | Safekeeping of clients' assets | Transaction confirmation workflow with dual approval. Staking operations monitoring. USDC ramp workflow with SSI verification. |
| **Art. 62** | Complaints handling | CommsThread with SLA tracking. Priority-based response times. Escalation workflows. Client contact preference management. |
| **Art. 63** | Conflicts of interest | Maker-checker separation. Audit trail of all approvals. Role-based access restrictions prevent self-approval. |
| **Art. 64** | Outsourcing | ServiceProvider model tracks third-party vendors. VendorReliabilityScore measures vendor performance. StatusPageEvent monitors vendor health. ClientServiceDependency maps client-vendor relationships. |

### 10.2 MiCAR Record Keeping (Art. 68)

| Requirement | Implementation |
|---|---|
| Records of all services, orders, transactions | AuditLog table captures all mutations. Transaction confirmations tracked end-to-end. |
| Records sufficient for supervisory purposes | Structured audit entries with before/after state. JSON details field for machine-readable data. |
| Retention for 5 years minimum | 7-year retention exceeds MiCAR minimum. Archive-before-purge for regulatory data. |
| Records provided to NCA on request | Export functionality with admin/auditor access. Structured JSON and CSV export formats. |

### 10.3 MiCAR IT Security (Art. 66)

| Requirement | Implementation |
|---|---|
| ICT risk management framework | Circuit breakers for external services. Health monitoring. Background job retry with dead letter queue. |
| ICT incident management | Structured incident model with automated detection, RCA workflow, and vendor response tracking. |
| ICT business continuity | Multi-region team coverage. Automated jobs with retry. Graceful degradation via circuit breakers. |
| ICT third-party risk | ServiceProvider model with reliability scoring. Status page monitoring. Dependency mapping. |

---

## 11. MAS (Singapore) Preparedness

### 11.1 Payment Services Act — Digital Payment Token (DPT)

| Requirement | Current Readiness | Gap/Action |
|---|---|---|
| AML/CFT controls | Travel rule case management, screening entries, counterparty verification | Ready — extend jurisdiction-specific fields if needed |
| Technology risk management (TRM) | CI/CD security gates, input validation, audit logging, incident management | Ready — may need MAS TRM Guidelines mapping document |
| Cybersecurity | CSP, HSTS, bcrypt, JWT sessions, input sanitisation | Ready — may need penetration testing report |
| Business continuity | Multi-region team, health monitoring, circuit breakers | Partially ready — need formal BCP document |
| Record keeping | 7-year retention, structured audit logs | Ready — exceeds MAS 5-year minimum |
| Complaints handling | SLA-tracked threads, escalation workflows | Ready |
| Client asset safeguards | Transaction confirmations, staking monitoring, settlement reconciliation | Ready |

### 11.2 MAS Notice PSN02 (Prevention of Money Laundering)

| Requirement | Status |
|---|---|
| Customer due diligence | Covered by travel rule case management and screening entries |
| Suspicious transaction reporting | Covered by screening classification and compliance review workflow |
| Record keeping | 7-year retention exceeds 5-year MAS requirement |
| Wire transfer requirements | Covered by travel rule case management (FATF-aligned) |

---

## 12. Control Evidence Directory

| Control Area | Primary Evidence Source | Secondary Evidence | Retention |
|---|---|---|---|
| Authentication | `SessionMetadata` table | Login-related `AuditLog` entries | 90 days (sessions), 7 years (audit) |
| Authorisation | `AUTHORIZATION_MATRIX` source code | `AuditLog` for permission-related actions | Source code in version control |
| Input validation | Zod schemas in `validation.ts` | CI gate verification | Source code in version control |
| Audit trail | `AuditLog` table | Structured logs (stdout/stderr) | 7 years |
| Data retention | `DataRetentionPolicy` table | Archive checksums and metadata | Per retention policy |
| Incident response | `Incident`, `IncidentUpdate` tables | `ExternalTicketEvent` table | 5 years |
| Change management | Git commit history | CI pipeline run logs | Version control + CI platform |
| Access review | `User` table, `Employee` table | `AuditLog` for role changes | 7 years |
| Vendor management | `ServiceProvider`, `VendorReliabilityScore` | `StatusPageEvent`, `ClientServiceDependency` | Indefinite (operational) |
| Transaction processing | `TransactionConfirmation`, `OesSettlement` | `AuditLog`, `ApprovalAuditEntry` | 7 years |
| Communications governance | `ClientCommsDraft`, `CommsThread` | `AuditLog` for sent communications | 7 years |
| Travel rule compliance | `TravelRuleCase`, `VaspContact` | `CaseNote`, `AuditLog` | 7 years |

---

## 13. Audit Trail Architecture

### 13.1 What is Audited

Every mutation in the system creates an `AuditLog` entry containing:

```
{
  action:     string    // e.g. "incident_created", "settlement_confirmed", "rca_transition"
  entityType: string    // e.g. "incident", "settlement", "thread"
  entityId:   string    // CUID of the affected record
  userId:     string    // CUID of the user who performed the action
  details:    JSON      // Structured object with before/after state, metadata
  createdAt:  DateTime  // Server timestamp (UTC)
}
```

### 13.2 Audit Categories

| Category | Actions Logged |
|---|---|
| **Authentication** | login_success, login_failure, session_revoked |
| **User management** | user_created, user_updated, user_deleted, role_changed |
| **Scoring** | score_created, score_updated, manual_override, config_change |
| **Thread management** | thread_created, thread_updated, ownership_change, status_change |
| **Incident management** | incident_created, incident_resolved, rca_transition, ticket_disputed |
| **Settlement** | settlement_confirmed, settlement_escalated, settlement_completed |
| **Transaction** | confirmation_acknowledged, confirmation_signed_off, confirmation_escalated |
| **Travel rule** | case_created, case_updated, case_resolved, email_sent |
| **Export** | export_requested, export_completed |
| **Client communications** | client_comms_sent, client_comms_dismissed |
| **Configuration** | scoring_config_activated, feature_flag_toggled, branding_updated |

### 13.3 Audit Integrity

- Audit writes are fire-and-forget — they never block or fail the primary operation
- No audit records are ever updated or deleted through the application
- Audit records include the `userId` foreign key to the Employee table for accountability
- The `AuditLog` table has composite indexes for efficient querying by time range, user, entity, and action type

---

## 14. Incident & Breach Response

### 14.1 Incident Classification

| Severity | Definition | Response Time | Escalation |
|---|---|---|---|
| **Critical** | Service outage affecting client assets or regulatory compliance | Immediate (P0) | All leads and admins notified via SSE + Slack |
| **High** | Degraded service affecting operations | 30 minutes (P1) | Team leads notified |
| **Medium** | Issue with workaround available | 4 hours (P2) | Assigned operator |
| **Low** | Minor issue, no operational impact | 24 hours (P3) | Assigned operator |

### 14.2 Incident Lifecycle

```
Created → Active → Monitoring → Resolved
                ↑                    │
                └────────────────────┘ (reopen)
```

### 14.3 RCA Workflow

```
None → Raised → Awaiting RCA → RCA Received → Follow-up Pending → Closed
                                                                        ↑
                                    Closed → Raised (re-open) ──────────┘
```

### 14.4 Automated Detection

- **AI Slack classification**: Service provider channel messages classified for urgency and incident indicators
- **Status page polling**: Every 5 minutes for all active service providers
- **SLA breach detection**: Every minute for all active threads
- **Staking anomaly detection**: Every 6 hours for all active wallets

---

## 15. Change Management Controls

### 15.1 CI/CD Pipeline Stages

| Stage | Controls | Blocking |
|---|---|---|
| **Lint** | ESLint code quality rules | Yes |
| **Type check** | TypeScript strict mode (`--noEmit`) | Yes |
| **Test** | Vitest unit/integration tests with coverage thresholds | Yes |
| **Security audit** | npm audit (critical + high production deps) | Yes |
| **Schema validation** | Prisma schema syntax and migration smoke test | Yes |
| **Build** | Next.js production build | Yes |
| **Docker** | Docker image build (main branch only) | Yes |

### 15.2 Security-Specific CI Gates

| Gate | What It Checks |
|---|---|
| All routes have auth guards | `grep -rL 'requireAuth'` finds zero non-health/auth routes |
| Mutation routes have Zod validation | All POST/PUT/PATCH routes contain `safeParse` |
| AI calls use safety wrappers | All files with AI calls contain `wrapUntrustedContent` or `untrusted_input` |
| No secrets in code | Pattern scan for hardcoded credentials |
| CSP header present | Content-Security-Policy configured in next.config.js |
| No legacy auth paths | Only `auth-options.ts` used for auth |
| Authorization matrix complete | All 4 roles defined with permissions |
| Sensitive action registry | All governance categories defined |

---

## 16. Third-Party Risk Management

### 16.1 Vendor Inventory

| Vendor Type | Examples | Monitoring Method |
|---|---|---|
| **Wallet technology** | Fireblocks, Ledger Enterprise | Status page polling, incident tracking, reliability scoring |
| **Travel rule** | Notabene | API health monitoring, case resolution tracking |
| **Chain analytics** | Chainalysis | Screening status tracking, support verification |
| **Exchange** | OKX | Settlement reconciliation, delegation status |
| **Communication** | Slack, SMTP | Circuit breaker health, message delivery tracking |

### 16.2 Vendor Reliability Scoring

Quarterly automated scoring (0-100 scale):

| Factor | Deduction |
|---|---|
| Each incident in period | -5 points |
| Average resolution time > 4 hours | -2 points per hour over threshold |
| Each client impact record | -10 points |
| Missed RCA SLA deadline | -5 points per incident |
| Each disputed ticket closure | -5 points |

### 16.3 Client Impact Tracking

When a vendor incident occurs:
1. AI detects incident from Slack or status page
2. System identifies affected clients via `ClientServiceDependency` mapping
3. `ClientImpactRecord` created for each affected client
4. AI drafts client communication (never auto-sent)
5. Human reviews, edits, and approves communication via two-step flow
6. Delivery tracked per recipient with retry on failure

---

## 17. Data Governance

### 17.1 Data Classification

| Classification | Definition | Examples | Controls |
|---|---|---|---|
| **Regulatory** | Data with regulatory retention requirements | Audit logs, travel rule cases | 7-year retention, encrypted archival, no deletion |
| **Operational** | Data required for platform operation | Threads, incidents, alerts | 1-5 year retention per type |
| **Transient** | Short-lived operational data | Session metadata, webhook events, job queue | 30-90 day retention, auto-purge |
| **Sensitive** | PII or financially sensitive data | Wallet addresses, email addresses, bank refs | Field-level masking for non-admin roles |

### 17.2 Data Residency

- Database hosted on PostgreSQL (configurable deployment region)
- Archives stored in cloud object storage (configurable region)
- No cross-border data transfers within application scope
- External integrations (Slack, Jira) are corporate-controlled SaaS

### 17.3 Data Subject Requests

| Request Type | Process |
|---|---|
| Access request | Export all `AuditLog`, `CommsThread`, `Employee` records for the data subject. Admin role required. |
| Rectification | Update records via standard edit flows. Correction logged in audit trail. |
| Erasure | Regulatory data exempt. Non-regulatory data anonymised (not deleted) to maintain referential integrity. |
| Portability | JSON export via admin export functionality. Structured format with schema documentation. |

---

## 18. Continuous Monitoring & Reporting

### 18.1 Automated Monitoring

| Monitor | Frequency | Alert Condition |
|---|---|---|
| SLA deadline check | Every 1 minute | Thread approaching or past SLA deadline |
| Staking reward heartbeat | Every 6 hours | Reward late beyond expected frequency |
| Status page polling | Every 5 minutes | Provider incident detected |
| Settlement reconciliation | Continuous | Match status = mismatch or missing_tx |
| Session cleanup | Daily at 2am | Expired sessions purged |
| Circuit breaker health | Continuous | Breaker state = open |

### 18.2 Reporting Capabilities

| Report | Audience | Frequency |
|---|---|---|
| Daily ops briefing (AI-generated) | All team | Daily |
| SLA compliance report | Leads, Admin | On-demand |
| Incident RCA summary | Leads, Admin, Auditor | Per incident |
| Vendor reliability scores | Leads, Admin | Quarterly |
| Audit log export | Auditor, Admin | On-demand |
| Travel rule compliance report | Compliance, Auditor | On-demand |

---

## 19. Gap Analysis & Remediation

### 19.1 Identified Gaps

| Gap | Priority | Regulation | Remediation Plan |
|---|---|---|---|
| **Formal BCP document** | High | MAS, VARA, FCA | Draft BCP covering DR procedures, failover, communication plan |
| **Penetration testing** | High | ISO 27001, VARA | Commission annual penetration test; document findings and remediation |
| **Data classification policy** | Medium | ISO 27001, MiCAR | Formalise data classification framework (this document provides initial mapping) |
| **MAS TRM Guidelines mapping** | Medium | MAS | Create dedicated MAS TRM Guidelines compliance matrix |
| **Vendor risk assessment template** | Medium | ISO 27001, MiCAR Art.64 | Create structured vendor onboarding risk assessment template |
| **Privacy impact assessment** | Low | ISO 27701 | Conduct PIA for platform — low risk given internal-only use |
| **Backup & restore testing** | Medium | ISO 27001 A.8.13 | Document and test backup restoration procedures quarterly |
| **Security awareness training** | Low | ISO 27001, FCA | Document training programme for platform users |

### 19.2 Remediation Timeline

| Quarter | Actions |
|---|---|
| **Q2 2026** | BCP document, penetration test commission, data classification formalisation |
| **Q3 2026** | MAS TRM mapping, vendor risk template, backup restore testing |
| **Q4 2026** | PIA, training programme documentation, annual review of this document |

---

*This document should be reviewed quarterly and updated when new controls are implemented, regulatory requirements change, or audit findings require remediation.*
