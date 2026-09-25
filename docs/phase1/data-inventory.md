# Data inventory

This inventory covers spec §17.5 and the D5 dataset cataloguing.

**Classification:** the application holds **confidential** data: client names, wallet addresses, transaction ids and amounts, client contact details, and staff identities. It also holds personal data (staff names, emails and absences; client contact names). That is recorded in the IT Services inventory entry (TODO(CONFIRM-SERVICE-OWNER)).

**Minimisation:** the application stores what each feature uses. It keeps identifiers and the fields each check needs, and does not mirror full Platform transaction history. Message bodies are kept for the inbox with the shortest retention that serves the audit need.

**Owners:** TODO(CONFIRM-DATA-OWNERS). Each group below needs a named owner. Until then, the service owner owns everything.

**Retention:** the periods that run today are the ones marked **enforced**. Everything else waits on TODO(CONFIRM-RETENTION) and is kept until that is decided. The generic retention policies in `src/lib/data-retention.ts` run daily in the `data_retention` job, but delete nothing until the setting `retention.enabled` is switched on once the periods are agreed; every run, including a skipped one, is recorded in `BackgroundJobRun` as evidence. Audit records are kept for at least the regulatory record-keeping period (TODO(CONFIRM-AUDIT-RETENTION)), and the application cannot delete them.

The test `data-inventory-covers-every-model` fails if a Prisma model is not listed here.

## 1. Staff and identity (personal data)

| Model | Contents | Source | Retention |
|---|---|---|---|
| Employee | Staff name, work email, team, region, role | Admin entry / HR | Leaver handling follows the HR process: work items and notes stay for audit; identity per policy (TODO(CONFIRM-LEAVER)) |
| User | Login principal: email, role (from Entra groups), linked employee | Entra SSO | As Employee |
| UserClientScope | Clients a user is restricted to | Admin | As User |
| SessionMetadata | Session id, user, created, last active, revoked | Sign-in | **Enforced:** deleted 7 days after expiry |
| UserNotificationPreference, InAppNotification | Notification settings and in-app messages | App | CONFIRM-RETENTION |
| OnCallSchedule, RotaAssignment, PtoRecord, PublicHoliday, SubTeam, TeamConfig | Rota, on-call, absences, holidays, team structure | Admin / leads | CONFIRM-RETENTION |
| LeadHandover | Daily lead handover text and post results | Leads | CONFIRM-RETENTION |
| ActivityStatus | Presence status. **Live activity tracking is off (H4).** | n/a | Not collected |
| TimePeriod, CategoryScore, KnowledgeScore, ScoringConfig, ScoreEvidence, EmployeeNote | Staff performance scoring. **Off (H4).** Tables kept for existing data only. | n/a | Not collected; archived scoring configs are deleted after 730 days once retention runs |

## 2. Clients (confidential)

| Model | Contents | Source | Retention |
|---|---|---|---|
| Client, ClientChannel | Client name, inbound threshold, mapped Slack channels and email domains | Admin | CONFIRM-RETENTION |
| ClientContactPreference | Client contact names, emails, phones, channels, hours | Admin | CONFIRM-RETENTION |
| ClientServiceDependency, ClientImpactRecord | Which client depends on which service; impact records | Admin / incidents | CONFIRM-RETENTION |
| ClientCommsDraft, ClientUpdate, OutboundMessageDraft | Human-written client communications and their approval state (H12) | Staff | CONFIRM-RETENTION (evidence: keep with the audit period) |

## 3. Work, tickets and communications

| Model | Contents | Source | Retention |
|---|---|---|---|
| WorkItem, TimeLog, TicketLink, SlaPolicy, SlaEvent | Work queue, effort buckets, ticket links, SLA clocks | App, Jira/JSM | CONFIRM-RETENTION |
| CommsThread, CommsMessage, OwnershipChange, ThreadNote, ThreadParticipant, ThreadLinkedRecord, MessageAttachment | Inbox threads and **message bodies** from Slack and mail | Slack, Graph | Message bodies: 365 days once `retention.enabled` is on |
| Incident, IncidentUpdate, IncidentCategory, IncidentLogDraft | Incidents, updates, categories, incident log drafts | Staff | CONFIRM-RETENTION |
| Project, ProjectMember, ProjectUpdate, ProjectTag, DailyTask | Internal projects and tasks | Staff | CONFIRM-RETENTION |

## 4. Custody and operations records (confidential)

Read from the custody provider (GET only), Platform, Confluence and imports. Addresses, transaction ids and amounts are **redacted in logs** (H8).

| Model | Contents | Source | Retention |
|---|---|---|---|
| SourceRecord | Normalised records from each source (identifiers and the fields the checks use) | custody API, Platform, imports | Proposed: 365 days after the source last returned it (policy "Source records no longer seen"; runs when retention is enabled, CONFIRM-RETENTION) |
| OesSettlement, OesWindow, SettlementStatusMap, SettlementNote | Exchange settlements, windows, status mapping, notes | The custody provider, admin | CONFIRM-RETENTION |
| TransactionConfirmation | Transaction confirmation records | Staff | CONFIRM-RETENTION |
| TravelRuleCase, CaseNote, VaspContact | Travel-rule cases (Notabene off, H11) | Staff | CONFIRM-RETENTION (regulatory) |
| ScreeningEntry | Screening results entered by staff | Staff / Chainalysis export | CONFIRM-RETENTION (regulatory) |
| StakingWallet, WalletTag, ApprovedValidator | Staking wallets and validators | Staff | CONFIRM-RETENTION |
| TokenReview, TokenDemandSignal | Token onboarding reviews | Staff | CONFIRM-RETENTION |
| UsdcRampRequest | USDC ramp workflow (module off by default) | Staff | CONFIRM-RETENTION |
| AssetThreshold, AssetStatus, RiskRuleTier | Thresholds and risk tier mapping (risk levels come from the source system, never computed locally, H5) | Admin | Configuration |
| BankInstruction, BankSettlementLog, BankFeeBalance, OtcBreakType | partner bank settlements and OTC break types | Mail / staff | CONFIRM-RETENTION |
| DailyCheckRun, DailyCheckItem, DailyCheckDefinition | Daily control checks and evidence | Staff, collectors | CONFIRM-RETENTION (control evidence) |

## 5. Alerts, monitoring and change

| Model | Contents | Source | Retention |
|---|---|---|---|
| Alert, AlertRule | Raised alerts and rule configuration | Engine, admin | Resolved alerts: 90 days once retention runs |
| SourceHeartbeat, PollCycle, SyncCursor | Polling health and cursors | Worker | **Enforced:** poll cycles deleted after 90 days |
| StatusPageEvent, ServiceProvider, VendorReliabilityScore | Vendor status and reliability | Vendors | CONFIRM-RETENTION |
| PlatformSprint, PlatformChange, PlatformImpactRule, UatTemplate | Platform release notes, changes, impact rules, UAT templates | Confluence, admin | CONFIRM-RETENTION |

## 6. Integration state

| Model | Contents | Source | Retention |
|---|---|---|---|
| JiraProjectConfig, JiraIssueEvent, ExternalTicketEvent | Jira project settings and ticket events | Jira | JiraIssueEvent proposed 180 days (policy "Old Jira issue events"); others CONFIRM-RETENTION |
| SlackChannel | Registered Slack channels and their client mapping | Admin | Configuration |
| WebhookEvent | Inbound webhook ids for replay protection | Slack, Jira | CONFIRM-RETENTION |

## 7. Evidence and system

| Model | Contents | Source | Retention |
|---|---|---|---|
| AuditLog | Who did what, the target, the result, the correlation id | App | **Append-only** (triggers and database role); at least the regulatory period (CONFIRM-AUDIT-RETENTION); never deleted by the app |
| BackgroundJob, BackgroundJobRun | Job queue; one row per execution attempt (evidence) | Worker | **Enforced:** runs deleted after 30 days (succeeded) or 400 days (other), with the floor enforced by the database. Completed one-off jobs: 30 days once retention runs |
| WorkflowEvent | Workflow transitions | App | CONFIRM-RETENTION |
| DataRetentionPolicy | Retention settings per entity type | Admin | Configuration |
| FeatureFlag, AppSetting, BrandingConfig | Configuration | Admin | Configuration |
| RateLimitBucket | Rate-limit counters (hashed account key or IP) | App | **Enforced:** idle buckets deleted after 1 day |
| IdempotencyKey | Hashed idempotency keys and request hashes (no request content) | App | **Enforced:** deleted when expired (10 s duplicate window, 24 h explicit keys) |
| ArchivedApprovalAuditEntry (`_archived_approval_audit_entry`) | Archived evidence of the removed approvals module (H1) | Legacy | Read-only; kept; never dropped |

## Encryption, backup and access

- TLS 1.2 or later everywhere, including to the database. Encryption at rest uses Azure platform encryption as a minimum (ask Security whether customer-managed keys are required at this classification).
- Automated backups with point-in-time restore. A restore is tested once before go-live, and the result is recorded.
- Database access goes through the roles in `db-roles.sql`: the runtime cannot alter or delete evidence; reporting is read-only.
