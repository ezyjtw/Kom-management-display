# KOMmand Centre — Product Overview

**Internal Operations Command Centre for Digital Asset Custody**

---

## 1. Executive Summary

KOMmand Centre is a purpose-built internal operations platform designed for institutional digital asset custody teams. It consolidates operational workflows, communications, compliance monitoring, incident management, and team performance into a single real-time dashboard.

The platform is built on Next.js 14 (TypeScript), backed by PostgreSQL via Prisma ORM, and deployed on Railway with Docker. Authentication uses NextAuth.js with JWT sessions and role-based access control (Admin / Lead / Employee).

**Core value proposition**: Replace fragmented spreadsheets, Slack channels, email threads, and manual checklists with one unified operational view that enforces ownership, tracks SLAs, and creates an immutable audit trail.

---

## 2. Platform Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 App Router, Tailwind CSS, Recharts |
| Backend | Next.js API Routes (REST), TypeScript |
| Database | PostgreSQL via Prisma ORM (38 models) |
| Auth | NextAuth.js — JWT sessions, bcrypt passwords, role-based guards |
| Deployment | Docker (multi-stage build), Railway, CI/CD via GitHub Actions |
| Security | HSTS, CSP, frame denial, nosniff, referrer policy, permissions policy |

### Authentication & Access Control

- **Three roles**: Admin, Lead, Employee
- **JWT sessions**: 24-hour expiry, role/team encoded in token
- **Route protection**: Middleware intercepts all protected routes before handlers
- **API-level RBAC**: Every API route enforces auth; sensitive routes require specific roles
- **Team scoping**: Leads see their team's data; employees see their own; admins see all
- **Audit logging**: Login success/failure, every data mutation, exports, ownership changes

---

## 3. Command Centre Dashboard (Landing Page)

The main dashboard is a dense, graphical overview that loads immediately after login. Every card is clickable, leading to the relevant module for drill-down.

### 3.1 Market Ticker Bar
- **Live cryptocurrency prices** for BTC, ETH, SOL, DOT, USDC, USDT, AVAX, LINK
- **7-day sparkline charts** per asset (Recharts AreaChart)
- **24-hour percentage change** with directional arrows (green/red)
- **ETH gas fee indicator** (gwei) with spike detection (>50 gwei)
- **Auto-refresh**: Market data refreshes every 60 seconds
- **Data source**: CoinGecko API (prices + sparklines), Etherscan API (gas)

### 3.2 Alert Banners
- **Active incident alerts** with severity-based styling (critical = pulsing red, warning = amber)
- **Market alerts**: Triggered when any tracked asset moves >5% in 24h (warning) or >10% (critical)
- **Gas spike alerts**: Triggered when average gas exceeds 50 gwei

### 3.3 Ops Vitals (Top Row — 4 cards)

| Card | Metric | Drill-down |
|------|--------|-----------|
| **SLA Breaches** | Count of threads past TTO/TTFA/TSLA deadlines, active threads, unassigned count | `/comms?view=overdue` |
| **Travel Rule** | Open cases, overdue count (>48h), aging count (24-48h) | `/travel-rule` |
| **Alerts** | Unacknowledged alert count | `/admin/alerts` |
| **Team Coverage** | Active staff / total, queue monitoring count, break count | `/activity` |

### 3.4 Mini Charts Row (6 cards with visualizations)

| Card | Visualization | Data |
|------|--------------|------|
| **Tasks** | Donut chart (PieChart) | Completed/In Progress/Pending daily tasks |
| **Staking** | Donut chart | On Time/Approaching/Overdue reward heartbeats |
| **Daily Checks** | Horizontal bar chart | Passed/Issues/Pending check items |
| **Screening** | Numeric count | Pending submissions, scam flags, open alerts |
| **RCA** | Numeric count | Total RCAs, awaiting, overdue, follow-up pending |
| **Tokens** | Numeric count | Pipeline count, compliance review, live count |

### 3.5 Detail Lists (3-column bottom row)

| Section | Content |
|---------|---------|
| **Urgent Travel Rule** | Top 4 most urgent cases with aging indicators (green/amber/red dots), asset, direction, truncated TX ID, age in hours/days |
| **SLA Breaches** | Top 4 breached threads with priority badge (P0-P3), subject, owner name |
| **Projects** | Top 4 active projects with name, progress bar (color-coded by %), completion percentage |

### 3.6 Activity Feed
- **3-column layout** showing last 9 audit entries
- Each entry: user name, action label (human-readable), relative timestamp
- Covers: travel rule actions, ownership changes, incidents, score updates, config changes

---

## 4. Communications & Ownership Module

### 4.1 Unified Inbox (`/comms`)
- **Source integration**: Email (IMAP), Slack, Jira — all synced into one thread view
- **View tabs**: All | Unassigned | My Threads | Overdue / SLA Breach
- **Filters**: Priority (P0-P3), Queue (Transaction Ops, Admin Ops, Data Ops), Source (email, slack, jira)
- **Thread list**: Subject, source icon, priority badge, owner, SLA status indicators, last message time
- **AI triage**: Bulk AI-powered priority suggestion (P0-P3 with reasoning) using configured LLM

### 4.2 Thread Detail (`/comms/thread/[id]`)
- **Message timeline**: Full conversation history with author, timestamp, body snippet, attachment indicators
- **Internal notes**: Private notes visible only to team (separate from external messages)
- **Ownership panel**: Current owner, secondary owners/watchers, transfer button with handover notes
- **Ownership history**: Full audit trail of every assignment, transfer, and handover note
- **SLA timers**: Live countdown for TTO, TTFA, and TSLA with breach indicators
- **Linked records**: Associated Jira tickets, Fireblocks transactions, Confluence pages
- **Status workflow**: Unassigned → Assigned → InProgress → WaitingExternal → WaitingInternal → Done → Closed
- **Actions**: Take ownership, transfer, add note, change status, change priority (lead/admin)

### 4.3 SLA Engine
Three independent clocks per thread, thresholds vary by priority:

| SLA Clock | P0 | P1 | P2 | P3 |
|-----------|-----|-----|-----|-----|
| **TTO** (Time to Ownership) | 5 min | 30 min | 2 hours | 8 hours |
| **TTFA** (Time to First Action) | 10 min | 1 hour | 4 hours | 16 hours |
| **TSLA** (Time Since Last Action) | Varies by status: InProgress=2h, WaitingExternal=8h, default=4h |

- **Bounce detection**: Flags threads with >2 ownership changes in 24 hours

---

## 5. Travel Rule Compliance (`/travel-rule`)

### 5.1 Reconciliation View
- **Automated matching**: Komainu custody transactions matched against Notabene travel rule transfers
- **Tabs**: All | No Travel Rule | Missing Originator | Missing Beneficiary | Matched
- **Asset filter**: Dropdown to filter by token type
- **Stats cards**: Total, Matched, Unmatched, Missing Originator, Missing Beneficiary
- **Table columns**: Transaction ID, TX hash, direction, asset, amount, sender/receiver addresses, match status

### 5.2 Case Management
- **Single case creation**: Click "Open Case" on any unmatched transaction
- **Bulk operations**: Checkbox-select multiple rows, then bulk create cases, bulk assign to employee, or bulk mark as not required
- **Case lifecycle**: Open → Investigating → PendingResponse → Resolved
- **Resolution types**: Info obtained, email sent, not required, escalated
- **Email integration**: Send travel rule information request emails directly from case view (SMTP)
- **VASP contact book**: Store counterparty VASP contacts for reuse
- **Case notes**: Internal notes per case with author attribution

### 5.3 Travel Rule SLA
- **48-hour resolution deadline** from case creation
- **Aging indicators**: Green (<24h), Amber (24-48h), Red (>48h)
- **Dashboard integration**: Urgent cases surface on Command Centre

---

## 6. Incident & RCA Management

### 6.1 Incidents (`/incidents`)
- **Track third-party provider incidents**: Fireblocks, Ledger, GX, Komainu, Notabene, Chainalysis, etc.
- **Severity levels**: Low, Medium, High, Critical
- **Status workflow**: Active → Monitoring → Resolved
- **Fields**: Title, provider, severity, description, operational impact
- **AI impact drafting**: AI-generated operational impact statements
- **Timeline updates**: Chronological update feed with update type (update, escalation, resolution)
- **Linked records**: Associated comms threads and transaction IDs

### 6.2 RCA Tracker (`/rca`)
- **RCA lifecycle**: Raised → Awaiting RCA → RCA Received → Follow-up Pending → Closed
- **SLA tracking**: Configurable deadline for receiving RCA from provider
- **Document linking**: Attach RCA document references
- **Follow-up checklist**: Track remediation items with completion status
- **External ticket integration** (Jira):
  - Link provider Jira tickets to incidents
  - Auto-sync ticket status from Jira API
  - **Dispute workflow**: Detect premature provider ticket closures, raise disputes, request reopens, post comments to Jira
  - Full ticket event history: status changes, closures, disputes, reopens
- **Summary cards**: Total RCAs, Awaiting, SLA Overdue, Follow-up Pending, Disputed Closures, Closed
- **Filter pills**: 8 status-based filters

---

## 7. OES Settlement Matching (`/settlements`)

- **Venue support**: OKX OES and Fireblocks OES
- **Settlement fields**: Reference, venue, client, account, asset, amount, direction (custody↔exchange), cycle timestamp
- **Matching workflow**: Match exchange instructions against on-chain transactions
- **Maker/Checker approval**: Dual-approval flow — maker confirms, then checker approves
- **Match statuses**: Pending, Matched, Mismatch, Missing TX, Flagged
- **OKX-specific**: Delegation status tracking (delegated/undelegated/pending)
- **Fireblocks-specific**: Transaction ID and signer group tracking
- **Expanded detail**: Wallet addresses, delegation info, audit trail (maker/checker timestamps), escalation notes
- **Filters**: Status tabs (5), venue filter (3), search bar (client, ref, asset, TX hash)
- **Stats**: 8 summary cards with counts by status and venue

---

## 8. USDC On/Off Ramp (`/usdc-ramp`)

- **Full pipeline workflow**:
  - **Onramp** (USD→USDC): Instruction received → USD received → Receipt confirmed → USD sent to issuer → USDC minted → USDC delivered → Completed
  - **Offramp** (USDC→USD): Instruction received → Accepted → USDC received → Conversion pending → USD sent → Completed
- **Compliance checks**: KYC/AML verification, wallet whitelisting
- **Bank details**: SWIFT reference, SSI verification, bank details
- **Wallet management**: Custody wallet, holding wallet, on-chain TX hash
- **Gas monitoring**: Gas wallet balance check with low-balance warning
- **Fee buffer**: Proprietary fee buffer tracking with low-buffer alert
- **Maker/Checker approval**: Dual-approval with notes
- **Evidence trail**: Attached evidence references (SWIFT confirmations, issuer reports)
- **Priority levels**: Low, Normal, High, Urgent

---

## 9. Screening & Chain Analytics (`/screening`)

- **Three views**: Screening Health | Classifications | Analytics Alerts
- **Transaction screening pipeline**: Not Submitted → Submitted → Processing → Completed
- **Classification system**: Unclassified, Legitimate, Dust, Scam
- **Chain analytics integration**: Alert ID tracking, alert status (open, under_review, resolved)
- **Compliance review**: Pending/approved/rejected compliance decisions
- **Known exceptions**: Flag entries as known exceptions with reason
- **Reclassification**: Change classification with audit trail
- **Summary cards**: Total, Submitted, Processing, Not Submitted, Dust, Scam

---

## 10. Staking Operations (`/staking`)

- **Wallet monitoring**: Track staking wallets across BTC, ETH, SOL, DOT, AVAX, and other assets
- **Reward heartbeat tracking**: Expected vs actual reward timing
  - **Reward models**: Auto, Daily, Weekly, Monthly, Manual Claim, Rebate
  - **Health indicators**: On Time (green), Approaching (amber, <4h to expected), Overdue (red)
- **Balance reconciliation**: On-chain balance vs platform balance with configurable variance threshold
- **Cold staking support**: Flag and filter cold staking wallets
- **Test wallet flag**: Separate test wallets from production
- **Views**: All Wallets | Reward Alerts | Cold Staking | Reconciliation
- **Summary cards**: Total Wallets, Active, Overdue Rewards, Cold Staking, Recon Flags

---

## 11. Token Review & Onboarding (`/tokens`)

### 11.1 Onboarding Pipeline
- **Status flow**: Proposed → Under Review → Compliance Review → Approved → Live (or Rejected)
- **Risk assessment**: Low / Medium / High / Critical with free-form notes
- **Compliance fields**: Sanctions check, AML risk assessment, regulatory notes
- **Vendor support matrix**: Chainalysis, Notabene, Fireblocks, Ledger — each tracked as supported/partial/not_supported/unknown
- **Custodian support**: Multi-select which custodians support the token
- **Market cap tier**: Mega, Large, Mid, Small, Micro, Unknown

### 11.2 Demand Analysis
- **Demand signals**: Client request, market trend, competitor listed, internal proposal
- **Signal weighting**: 1-5 strength per signal
- **Demand score**: 0-100 computed aggregate from signals

### 11.3 AI-Powered Research
- **AI token research**: Automated due diligence report covering market analysis, regulatory landscape, technical assessment, custody compatibility
- **AI recommendation**: Approve, Approve with Conditions, Further Review, Reject
- **AI discovery**: Suggest tokens with institutional demand gaps based on current portfolio

---

## 12. Daily Operations

### 12.1 Daily Checks (`/daily-checks`)
- **Structured checklist**: Predefined check items by category (stuck TX, balance variance, staking rewards, screening, travel rule, pending approvals, scam/dust, validator health, external provider)
- **Status per item**: Pending, Pass, Issues Found, Skipped
- **Auto-check capability**: Automated pass/fail for items with auto-check keys
- **Issue logging**: Free-text notes when issues found
- **Progress tracking**: Visual progress bar with pass/issues counts
- **Jira summary generator**: One-click copy of formatted checklist summary for Jira

### 12.2 Schedule & Tasks (`/schedule`)
- **On-call management**: Assign primary/backup shifts per team per date
- **PTO tracking**: Annual leave, sick, WFH, other — with approval workflow
- **Public holidays**: Configurable by region (Global, EMEA, APAC, Americas)
- **Daily task management**: Create, assign, prioritize, and track completion
- **Calendar view**: Month navigation with on-call/PTO/holiday indicators
- **Team summaries**: Per-team cards showing lead, task counts, coverage

### 12.3 Activity Tracker (`/activity`)
- **Live status board**: Per-employee current activity with elapsed time
- **8 activity types**: Project, BAU, Queue Monitoring, Lunch, Break, Meeting, Admin, Training
- **Coverage monitoring**: Active staff, queue coverage, break counts
- **Time breakdown view**: Daily aggregate bar chart by activity type
- **Activity timeline**: Chronological history of all activities
- **Auto-refresh**: Every 30 seconds

---

## 13. Approvals Queue (`/approvals`)

- **Komainu API integration**: Fetches pending custody approval requests
- **Risk-based swimlanes**: Three columns — Should Auto-Approve, Ops Approval, Compliance Review
- **Per-request display**: Type, risk level, entity, account, age, expiration countdown
- **Actions**: Approve, Escalate (with notes), Flag Stuck (with reason)
- **Audit trail**: Every approval action logged to ApprovalAuditEntry table

---

## 14. Client Issues Monitor (`/clients`)

- **Aggregated client view**: Cross-reference comms threads and travel rule cases per client/counterparty
- **Severity scoring**: Weighted sum of thread count, SLA breaches, high-priority escalations, recurring issues
- **Ranked list**: Clients sorted by severity score
- **Expandable detail**: Per-client breakdown of threads, messages, sources, latest activity
- **Time filter**: Configurable lookback period (default 30 days)

---

## 15. Projects (`/projects`)

- **Project lifecycle**: Planned → Active → On Hold → Completed → Cancelled
- **Priority levels**: Low, Medium, High, Critical
- **Progress tracking**: 0-100% with visual progress bar
- **Team assignment**: Project lead + team members with roles (lead, contributor, reviewer)
- **Update timeline**: Chronological feed with typed updates (Progress, Blocker, Milestone, Note)
- **Overdue detection**: Flags active projects past target date
- **Filters**: Team dropdown, status dropdown
- **Stats cards**: Active, On Hold, Average Progress, Overdue

---

## 16. Performance Scoring

### 16.1 Team Overview (`/dashboard`)
- **Employee table**: All staff with per-category scores, overall score, trends, risk flags
- **Period selector**: Week, Month, Quarter
- **Filters**: Team, Role
- **Trend indicators**: Up/down/flat arrows with delta values
- **Risk flags**: Quality declining, throughput dropping, documentation stalled

### 16.2 Employee Detail (`/employee/[id]`)
- **Scorecard**: 5-category radar with current scores
- **Evidence panels**: Supporting data per category
- **Trend charts**: Score history over time
- **Knowledge scores**: Manual rubric (Operational Understanding, Asset Knowledge, Compliance Awareness, Incident Response)
- **Manager/employee notes**: Per-period notes with author attribution

### 16.3 Scoring Engine
- **Scale**: 3-8 (avoids false precision of 1-10)
- **5 categories** with configurable weights:

| Category | Weight | Components |
|----------|--------|-----------|
| Daily Tasks | 25% | Ticket throughput (40%), on-time rate (30%), cycle time (20%), quality (10%) |
| Asset Actions | 25% | Completed actions, SLA compliance, complexity |
| Quality | 25% | Severity-weighted mistakes offset by positive contributions |
| Projects | 15% | Pages created/updated, quality markers |
| Knowledge | 10% | Monthly rubric scored by lead (1-10 → mapped to 3-8) |

- **Formula**: Raw index (0-1) → Score = 3 + (rawIndex × 5), clamped to [3, 8]
- **Overall**: Weighted average of category scores
- **PTO adjustment**: Target throughput scales by working days ratio
- **Versioned config**: Scoring weights stored in database with version control, admin-configurable

---

## 17. AI Capabilities

- **3 provider options**: Anthropic Claude, Groq (free tier), Local Ollama
- **Morning briefing**: AI-generated executive summary of operational status
- **Thread triage**: AI suggests priority (P0-P3) with reasoning for comms threads
- **Incident impact**: AI drafts operational impact statements from incident details
- **Client pattern analysis**: AI identifies patterns in client activity data
- **Travel rule email drafting**: AI composes compliance outreach emails
- **Token research**: AI performs due diligence on token custody suitability
- **Token discovery**: AI identifies institutional demand gaps and suggests tokens to onboard

---

## 18. Admin Panel (`/admin`)

### Tabs:
- **Employees**: Create/edit staff, assign team/role/region, activate/deactivate
- **Users**: Create login accounts, assign roles, link to employee records
- **Scoring Config**: Edit category weights with version control, create new config versions
- **Role Targets**: Set per-role performance targets (Analyst/Senior/Lead) for each category
- **Knowledge Rubric**: Manual scoring interface for crypto knowledge assessment
- **Branding**: Upload custom logo (PDF/image, max 512KB), set app name and subtitle
- **Alerts** (`/admin/alerts`): View/acknowledge/resolve system alerts, trigger alert generation scan
- **Audit Log** (`/admin/audit`): Paginated, filterable log of all system actions
- **Analytics** (`/admin/analytics`): Team performance analytics and trends

---

## 19. White-Label Branding

- **Admin-configurable**: Logo, app name, subtitle — all editable from Admin panel
- **Logo upload**: Supports PDF, PNG, JPG, SVG (max 512KB, stored as base64)
- **Live preview**: See branding changes before saving
- **Applied everywhere**: Login page, sidebar, Command Centre header
- **Environment fallback**: Falls back to env vars if no DB config exists

---

## 20. Integration Points

### Currently Built (needs credentials only):

| Integration | Purpose | Auth Method |
|------------|---------|------------|
| **Komainu Custody API** | Pending transactions, approval requests, approve/reject | JWT bearer token (api_user + api_secret) |
| **Notabene Travel Rule** | Transfer matching, originator/beneficiary data | Bearer token |
| **Jira Cloud** | Comms thread sync, RCA ticket tracking, status polling | Basic auth (email + API token) |
| **Slack** | Channel message ingestion into unified inbox, notifications | Bot token (OAuth) |
| **Email (IMAP)** | Shared mailbox ingestion into comms threads | IMAP credentials |
| **Email (SMTP)** | Travel rule outbound emails, notifications | SMTP credentials |
| **CoinGecko** | Market prices, sparklines, 24h change | Public API (no key) |
| **Etherscan** | ETH gas fee monitoring | Public API (no key) |
| **AI (Groq/Claude/Ollama)** | Briefings, triage, research, drafting | API key per provider |

### Planned / Referenced (not yet built):

| Integration | Purpose |
|------------|---------|
| **Fireblocks** | OES settlement matching, vault balances, TX signing status |
| **Chainalysis KYT** | Real-time transaction risk scoring, automated screening |
| **Confluence** | Documentation sync for scoring/analytics |

---

## 21. Data Export & Reporting

- **CSV export**: Performance data export with period/employee filters
- **JSON export**: Same data in JSON format
- **Access control**: Admin and Lead roles only
- **Audit logged**: Every export recorded with format, period, scope, record count
- **Jira summary copy**: Daily checks generate formatted Jira summary for clipboard

---

## 22. Security Posture

| Control | Implementation |
|---------|---------------|
| Authentication | NextAuth.js credentials provider, bcrypt (12 rounds), 8-char minimum |
| Sessions | JWT, 24-hour expiry, secure cookie handling |
| Authorization | Role-based (Admin/Lead/Employee), team-scoped data access |
| Security headers | HSTS, X-Frame-Options DENY, nosniff, CSP, Permissions-Policy |
| CSP | No unsafe-eval; self + unsafe-inline (Next.js requirement) |
| Error handling | Sanitized error messages (Prisma errors mapped to safe messages) |
| Audit trail | Immutable append-only log for all sensitive actions |
| Container | Non-root Docker user |
| CI/CD | Lint, type-check, build, Docker build on every push |
| Input validation | API-boundary validation on all mutation endpoints |
| CRON protection | Alert generation endpoint protected by CRON_SECRET bearer token |

---

## 23. Deployment & Infrastructure

- **Hosting**: Railway (or any Docker-compatible PaaS)
- **Database**: Railway PostgreSQL plugin (auto-injected connection string)
- **Docker**: Multi-stage build — builder generates Prisma client, runner uses standalone Next.js output
- **Startup**: `start.sh` runs `prisma migrate deploy` + seed on every container start
- **Health check**: `/api/health` verifies Prisma connectivity, returns DB status + build version
- **CI pipeline**: GitHub Actions — lint → type-check → build → Docker build (on main push)
- **Local dev**: `docker-compose.yml` with PostgreSQL 16 + app service

---

## 24. Database Schema Summary

**38 models** across 8 domains:

| Domain | Models |
|--------|--------|
| **Core** | Employee, User |
| **Scoring** | TimePeriod, CategoryScore, KnowledgeScore, ScoringConfig, EmployeeNote |
| **Communications** | CommsThread, CommsMessage, OwnershipChange, ThreadNote |
| **Travel Rule** | TravelRuleCase, VaspContact, CaseNote |
| **Scheduling** | OnCallSchedule, PublicHoliday, PtoRecord, DailyTask, SubTeam, RotaAssignment |
| **Operations** | Project, ProjectMember, ProjectUpdate, ActivityStatus, Alert, Incident, IncidentUpdate, ExternalTicketEvent, OesSettlement, UsdcRampRequest, StakingWallet, DailyCheckRun, DailyCheckItem, ScreeningEntry, ApprovalAuditEntry, TokenReview, TokenDemandSignal |
| **Config** | BrandingConfig |
| **Audit** | AuditLog |
