# KOMmand Centre — Phase 1 Build Specification for Claude Code

**Owner:** James Wright, Head of Transaction Operations
**Status:** Draft for human review. Nothing in this specification authorises connection to production systems. Security, Compliance and IT review is required before any live credential is used.
**Repository:** `Kom-management-display` (Next.js 14, TypeScript, Prisma/PostgreSQL, NextAuth)
**Date:** 23 September 2026

---

## 0. How to use this document (read first, Claude Code)

This document is the single source of requirements for Phase 1. Read it end to end before writing any code. Then work through the phases in order (Section 5 onwards). Each phase ends with a **STOP** point. At each STOP, summarise what changed, list the tests added, and wait for human confirmation before starting the next phase.

Rules for working through this spec:

1. **One phase per branch and pull request.** Name branches `phase-<n>-<short-name>`, for example `phase-0-remove-approvals`. Never mix phases in one PR.
2. **Run `npm run ci:check` before every commit you propose.** It runs Prisma generate, typecheck, lint, tests and build. Do not propose a commit that fails it.
3. **Every behaviour in this spec needs a test.** Where a section lists "Acceptance tests", implement each one as a named Vitest test. Use the existing folders: unit tests in `src/__tests__/`, integration tests in `src/__tests__/integration/`.
4. **Never guess an external format.** Where this spec says **CONFIRM**, a message format, field value, threshold or endpoint behaviour is not yet known. Build the code path behind configuration or a feature flag, write the parser against a fixture file, and leave a `TODO(CONFIRM-<id>)` comment. Section 17 lists every CONFIRM item. Do not invent sample payloads beyond what this spec gives. Where you need a fixture, create a clearly marked synthetic one under `src/__tests__/fixtures/synthetic/`, and name the file with the CONFIRM id.
5. **Ask rather than assume** when this spec and the code disagree. Stop and report the conflict.
6. **Do not modify Jira or Confluence configuration, workflows, automation rules or permissions** from code or scripts. Phase 1 may only create and update work items, comments, assignees, labels, fields and transitions in the projects listed in Section 8.3.
7. **Do not add dependencies** without stating why in the PR description. Prefer libraries already in `package.json`.

### Suggested `CLAUDE.md` snippet

Add this to the repository root `CLAUDE.md` (create it if absent) so every session starts with the hard rules:

```markdown
# KOMmand Centre — standing rules
- Read docs/phase1/PHASE1_BUILD_SPEC.md before any change.
- NEVER add code that approves, rejects, confirms, cancels, initiates or signs a transaction or request on any custody platform. The Komainu API client is GET-only (plus POST /v1/auth/token). A test enforces this.
- AI features, staff performance scoring and live activity tracking stay disabled. Do not re-enable.
- No secrets in code, fixtures, logs or commits. Use env vars validated in src/lib/env.ts.
- Redact wallet addresses, tx hashes, client names and account numbers in logs.
- Use api-demo.komainu.io or mocks only. Never point code or tests at production endpoints.
- Run `npm run ci:check` before proposing a commit. One phase per PR. Stop at each STOP point.
```

Save this specification in the repository as `docs/phase1/PHASE1_BUILD_SPEC.md`.

---

## 1. Goal

Transaction Operations will run the **whole desk from one screen**. Everything the team does day to day must appear in KOMmand Centre:
- the 27 recurring tasks and checks;
- client questions;
- alerts;
- vendor tickets;
- the morning call.

Specifically:

- **Every issue, problem, risk and client question becomes a ticket automatically.** The system creates the ticket; people cannot skip writing it up.
- **Responsiveness is high and measured.** SLA clocks start at the client's message or the triggering event, not when someone notices.
- **Alerts fire for events that need a human response**, including silence: a feed or check that stops producing data is itself an alert.
- **Management reporting**: roughly how much team time each client takes, and responsiveness against internal SLAs. Reporting is at team and client level only.
- **Systems of record stay where they are.** Jira Service Management (JSM) holds client requests, Jira holds internal work, and GX and the custody platforms hold transactions. KOMmand Centre reads from them and writes back ownership, status and comments only.

## 2. Hard constraints (non-negotiable)

These override anything else in this document or the codebase. Each has an enforcing test.

| # | Constraint | Enforcement |
|---|---|---|
| H1 | **No transaction approval of any kind.** Nothing may approve, reject, confirm, cancel, sign, create or initiate a transaction, request, wallet, whitelist or collateral operation on the Komainu API, GX, Fireblocks, Ledger or any other platform. This includes "sign-off" semantics that stand in for an approval. | Phase 0 deletions; allowlisted HTTP client; test `custody-client-is-read-only` (Section 5.4) |
| H2 | **Read-only Komainu API.** The only permitted non-GET call is `POST /v1/auth/token`. The API user must have no write rights (a Komainu-side configuration, outside this repo). | Allowlist in `src/lib/integrations/komainu-api/client.ts`; test |
| H3 | **AI features off.** AI triage, briefing, drafting, token research, the compliance bot and AI incident drafting stay disabled. The default AI provider must not be Groq. | Feature flags default `false`; env default `AI_PROVIDER=none`; test `ai-disabled-by-default` |
| H4 | **No staff surveillance.** Performance scoring, the employee scorecard, and live activity or break tracking are disabled. Metrics are team and client level only. | Feature flags; route guards; test `no-per-person-metrics-in-reports` |
| H5 | **Scoped designs are not live behaviour.** GX design documents in the Confluence AMTK space (for example the Transaction Risk Policy and Transaction Approval Policy FSD and TSD pages) describe scoped designs, not current behaviour. Do not implement them as live logic. Risk levels come from GX's actual outputs (Section 11.4), never from a local re-implementation. The existing `assessRiskLevel()` in `src/lib/transaction-confirmation.ts` is a local amount-based guess and must be removed. | Code review; test `no-local-risk-scoring` |
| H6 | **New wallet technology is not live.** Anything referring to new Komainu wallet technology (for example the `WT` Jira project) is still being scoped. Do not integrate it. | Scope |
| H7 | **Secrets.** No secret in code, fixtures, seed or logs. All secrets come from env vars validated in `src/lib/env.ts` and documented in `.env.example` with empty values. | `scripts/validate-env-schema.ts`; existing security tests |
| H8 | **Confidential data in logs.** Wallet addresses, tx hashes, client or organisation names, account numbers, user IPs and geolocation must be redacted in application logs. Use a `redact()` helper in `src/lib/logger.ts`. | Test `logger-redacts-sensitive-fields` |
| H9 | **No production targets in dev or tests.** Tests use mocks or `https://api-demo.komainu.io`. | Test that the base URL in `.env.example` and fixtures is not `api.komainu.io` |
| H10 | **Hosting.** Remove Railway-specific configuration from the default path. Target Komainu's Azure environment (Section 6.3). Do not provision cloud resources from this repo. | Review |
| H11 | **Notabene connection held.** Following Notabene's reported data breach (IAI #128, 14 September 2026), the Notabene connector ships disabled behind flag `integration.notabene.enabled=false`. | Feature flag; test |

---

## 3. Repository orientation (current state)

These facts about the codebase were verified by reading it. Re-verify each before relying on it.

- **App routes:** `src/app/*` (pages) and `src/app/api/*` (REST routes). Middleware enforces auth, and each route calls `requireAuth()` and `requireAuthorization(auth, resource, action)` from `src/modules/auth/services/authorization.ts`. The authorisation matrix lives in `src/modules/auth/types/index.ts` (`AUTHORIZATION_MATRIX`, `Resource`, `Action`).
- **Integration layer:** `src/modules/integrations/` (the `IntegrationAdapter` interface, `registry.ts`, and adapters for slack, email, jira, fireblocks, custody and notabene). Older direct clients sit in `src/lib/integrations/*.ts`. Webhook deduplication uses the `WebhookEvent` table. Circuit breaker is in `src/lib/circuit-breaker.ts`.
- **Jobs:** `src/lib/background-jobs.ts` defines `JobType`, `registerDefaultJobs()` (cron expressions), `claimNextJob()`, `completeJob()`, `failJob()` and `workerHeartbeat()`. **No always-on worker process exists.** Jobs only run when an admin calls `POST /api/jobs` with `process_next`. This must be fixed (Section 6.1).
- **SLA:** `src/lib/sla.ts` provides TTO, TTFA and TSLA thresholds by priority P0 to P3 (`DEFAULT_SLA_THRESHOLDS`) and the travel rule 48-hour SLA.
- **Alerts:** the `Alert` model plus `src/modules/alerts/services/alert-service.ts`, and `POST /api/alerts/generate` (protected by `CRON_SECRET`). Alerts can currently be acknowledged with no note and no ticket link. This must change.
- **Comms:** `CommsThread`, `CommsMessage`, `OwnershipChange`, `ThreadNote`. Closing a thread already requires a resolution note (`src/app/api/comms/threads/[id]/status/route.ts`), which is good and must be kept.
- **Slack ingestion:** `src/modules/slack/services/slack-ingestion-service.ts` upserts every root message in a registered `SlackChannel` as a `CommsThread`, regardless of sender, and **skips `bot_message`** subtypes. `SlackChannel.channelType` is `client | service_provider | internal`.
- **Daily checks:** `DailyCheckRun` (one per day) and `DailyCheckItem`, with nine generic seeded items. Items can be set to `pass` or `skipped` with no evidence. `jiraSummary` is copied to the clipboard by hand.
- **Transaction confirmation:** `TransactionConfirmation` model and `src/lib/transaction-confirmation.ts`. These use a **locally invented risk assessment** (amount thresholds) and statuses including `signed_off`. Both conflict with H1 and H5 (see Phase 0).
- **Auth:** NextAuth credentials provider (local passwords), JWT sessions, roles `admin | lead | employee | auditor`.
- **Deploy:** Dockerfile, `docker-compose.yml`, `railway.toml`. `start.sh` runs migrations and seed on start.
- **Tests:** Vitest, with suites in `src/__tests__/` and `src/tests/`. CI is `.github/workflows/ci.yml`.

## 4. Target architecture

```
Sources (read)                      Core (KOMmand Centre)                         Systems of record (write-back: ownership/status/comments only)
─────────────                       ────────────────────                          ──────────────────────────────────────────────────────────────
Komainu API (GET only)  ─┐
Slack (client + GX bot)  ─┤
Outlook (shared inboxes) ─┤  adapters → NormalizedEvent → Domain services:           ┌─> JSM (client requests, SLAs)
Teams (channels)         ─┼─────────────────────────────── • WorkItem (unified)   ────┤
Jira / JSM               ─┤                                • AlertEngine + Rules      └─> Jira (OTC, TOPS, VSR, KPR, IAI, TOKENS, FOA, AO)
Chainalysis (import)     ─┤                                • TicketEnforcer
Power BI / Tatum (import)─┤                                • SlaClock + Metrics
Vendor portals (email)   ─┘                                • DailyCheck engine
                                                           • Heartbeats
                                   UI: Work queue · Team boards · Daily checks · Alerts · Clients · Metrics · Morning board
```

Principles:

1. **WorkItem is the single queue.** Every actionable thing becomes a `WorkItem` row linked to exactly one ticket in JSM or Jira: client questions, alerts, failed checks, vendor tickets, FAB instructions, MTD breaks and so on.
2. **The ticket is the record; KOMmand Centre is the view.** Status and ownership changes made in KOMmand Centre are written to the ticket first. The local row updates from the ticket's response, so a failed write-back is visible as an error, never a silent divergence.
3. **Everything is idempotent** by `(sourceSystem, sourceId)`, reusing the existing deduplication pattern.
4. **All times are stored in UTC.** Display in `Europe/London` by default, with per-user timezone for Jersey, Dubai and Singapore staff.

---

## 5. PHASE 0 — Remove transaction approval and unsafe features

Branch: `phase-0-remove-approvals`. This phase must merge before any other.

### 5.1 Delete (files and routes)

Delete these entirely. Do not leave dead code or disabled stubs.

- `src/app/approvals/` (the page) and `src/app/api/approvals/route.ts`.
- `src/app/api/travel-rule/cases/[id]/approve-api/route.ts`. It calls `approveRequest()` on the custody API. Remove any UI button or call to it in `src/app/travel-rule/case/[id]/page.tsx`. Keep the case page otherwise.
- In `src/lib/integrations/custody.ts`: delete `approveRequest()` and the generic `custodyPost()`. Then replace the whole file with the new read-only client in Section 8.1 and delete the old file.
- In `src/modules/integrations/adapters/custody-adapter.ts`: remove any non-GET call. Re-point it to the new client in Section 8.1.
- Sidebar entry `{ href: "/approvals", label: "Approvals Queue" }` in `src/components/shared/Sidebar.tsx`.
- `ApprovalAuditEntry` model: stop writing to it. Create migration `0017_drop_approval_audit_entry`, which archives the table (rename to `_archived_approval_audit_entry`) rather than dropping it, so historical audit evidence is preserved. Remove it from the Prisma client models.
- The `approvalActionSchema` and `approveCustodySchema` definitions in `src/lib/validation.ts`.
- Any seed data for approvals in `prisma/seed.ts`.

### 5.2 Rework: transaction confirmation becomes "awaiting a human" (read-only)

`TransactionConfirmation` currently implies sign-off in the dashboard. Change it to a **read-only tracker of GX risk-flagged transactions awaiting human action in GX**:

- Remove `assessRiskLevel()`. The risk level must come from GX (Section 11.4). If no GX risk level is available, the record's `riskLevel` is `unknown`, a new enum value that you add.
- Rename statuses in a migration. Map `signed_off` to `closed_in_source` and `acknowledged` to `owned`, and add `unknown` to `TransactionRiskLevel`. The only human actions allowed in KOMmand Centre are:
  - **take ownership** ("I am handling this in GX");
  - **add note**;
  - **link ticket**.
- Closure happens automatically when the Komainu API shows the request is no longer `PENDING`, via the `closed_in_source` transition.
- Remove `approve` from the `Action` permissions for `transaction_confirmation`, `settlement`, `usdc_ramp` and `travel_rule_case` in `AUTHORIZATION_MATRIX`. Keep `approve` only where it concerns non-transaction internal artefacts: scoring config versions (now disabled) and client-comms drafts.
- Update `src/__tests__/transaction-confirmation.test.ts` accordingly.

### 5.3 Disable (feature-flag off, hide navigation, return 404 from routes when off)

Create feature flags (in the `FeatureFlag` table seed and `src/lib/feature-flags.ts` defaults), all defaulting to `false`:

| Flag key | Covers |
|---|---|
| `ai.enabled` | `src/lib/ai.ts`, `src/lib/ai-thread-classifier.ts`, `src/lib/ai-comms-drafter.ts`, `src/app/api/ai/*`, `src/app/briefing`, AI buttons in incidents, tokens and travel rule |
| `ai.compliance_bot` | `src/app/compliance-bot`, `src/app/api/compliance-bot`. This bot presents itself as an authoritative compliance officer; it must stay off permanently unless Compliance approves |
| `people.scoring` | `src/app/dashboard` (team scores), `src/app/employee/[id]`, `src/app/api/scores*`, `src/app/api/scoring-config`, admin scoring tabs, scoring jobs |
| `people.activity_tracking` | `src/app/activity`, `src/app/api/activity`, Team Coverage card fields showing lunch or break |
| `module.usdc_ramp` | `src/app/usdc-ramp`, `src/app/api/usdc-ramp` (not a current team process) |
| `integration.notabene.enabled` | Notabene adapter and routes (H11) |

Set `AI_PROVIDER` default to `none` in `src/lib/ai.ts` and `.env.example`. When the value is `none`, every AI call returns a typed "disabled" result.

### 5.4 Acceptance tests (Phase 0)

- `custody-client-is-read-only`: statically scan `src/` for `fetch(` or HTTP client calls whose URL contains the Komainu API base-URL env var, and fail on any method other than GET, except `POST /v1/auth/token`. Also unit-test that the client throws `ForbiddenMethodError` for POST, PUT, PATCH and DELETE.
- `no-approval-routes`: assert that no route file exists under paths containing `approve` in `src/app/api`, except `client-comms/[id]/approve` (comms drafts), and that no source file references `/v1/requests/` together with `approve`, `reject`, `confirm`, `cancel` or `challenge`.
- `ai-disabled-by-default`: with a clean DB, every AI route returns 404 and `getProvider()` returns `none`.
- `no-local-risk-scoring`: `assessRiskLevel` is not exported anywhere.
- `flags-default-off`: all flags in 5.3 resolve `false` on a fresh seed.

**STOP 0.** Report deletions, migrations, and the updated authorisation matrix diff.

---

## 6. PHASE 1 — Platform foundations

Branch: `phase-1-platform`.

### 6.1 Always-on worker

Alerting and SLAs need jobs to run without a human.

- Create `src/worker/index.ts`, a long-running Node process that:
  1. calls `registerDefaultJobs()` on start;
  2. loops `claimNextJob()` → dispatch → `completeJob()` or `failJob()`;
  3. writes `workerHeartbeat(workerId)` every 30 seconds;
  4. on SIGTERM, drains the in-flight job for up to 25 seconds and then exits.
- Move the job dispatch `switch` out of `src/app/api/jobs/route.ts` into `src/worker/dispatch.ts` so the API route and the worker share one handler map. The API route keeps admin-only `trigger` and `process_next` for manual use.
- Add npm script `"worker": "tsx src/worker/index.ts"`. Add a second service `worker` to `docker-compose.yml` using the same image with command `npm run worker`.
- Recurring jobs must compute `nextRunAt` from `cronExpression`, using the `cron-parser` library (add it and justify in the PR). They must never overlap: skip a run if the previous run of the same type is still `running`.
- **Heartbeat alert:** if `isAnyWorkerAlive(120000)` is false, the web app shows a red banner on every page and alert `ALR-HB-WORKER` fires. That alert has to fire from outside the worker: add a lightweight check in `/api/health` and expose `worker_alive=false` for external monitoring.

### 6.2 Single sign-on (Entra ID)

- Add NextAuth `AzureADProvider` in `src/lib/auth-options.ts`, configured by `AZURE_AD_TENANT_ID`, `AZURE_AD_CLIENT_ID` and `AZURE_AD_CLIENT_SECRET`.
- Map Entra group object IDs to roles with env `ROLE_GROUP_MAP` (JSON, for example `{"<groupId>":"lead"}`). A user with no mapped group is denied.
- Link each SSO user to an `Employee` record by email. First login with no `Employee` match is denied and audit-logged.
- Keep `CredentialsProvider` only when `NODE_ENV !== "production"` **and** `ALLOW_LOCAL_LOGIN=true`. In production the credentials provider must not be registered. Test: `prod-has-no-credentials-provider`.
- Session lifetime 12 hours. Keep the existing session-revocation logic.

### 6.3 Hosting and configuration

- Keep the Dockerfile. Remove `railway.toml` from the default deploy path by moving it to `deploy/legacy/railway.toml` with a README saying it is not for production.
- Add `deploy/azure/README.md` describing the expected runtime for IT to review. Do not write infrastructure code:
  - two containers (web and worker) sharing one PostgreSQL;
  - Key Vault for secrets;
  - private networking;
  - egress allowlist.
- `start.sh` must **not** seed in production. Seed only when `ALLOW_SEED=true`, which is the existing variable.
- Add all new env vars to `src/lib/env.ts` validation, to `.env.example` with empty values, and to `docs/deployment.md`.

### 6.4 Egress allowlist (documented and enforced in code)

Create `src/lib/http/allowed-hosts.ts`, exporting the permitted hostnames from env. All outbound HTTP must go through `src/lib/http/client.ts`, which rejects hosts not on the list. The expected list:
- the Komainu API host;
- the Atlassian site (`komainu.atlassian.net`);
- `api.atlassian.com` if needed;
- `slack.com`;
- `graph.microsoft.com`;
- `login.microsoftonline.com`.

The CoinGecko and Etherscan market ticker is non-essential. Put it behind flag `module.market_ticker`, default `false`.

**STOP 1.**

---

## 7. PHASE 2 — Core data model

Branch: `phase-2-data-model`. Write Prisma models and migrations (`0018_…` onwards). Use `cuid()` ids, `createdAt` and `updatedAt`, and indexes on every foreign key and status field.

### 7.1 Client

```prisma
model Client {
  id                 String   @id @default(cuid())
  displayName        String
  komainuOrgId       String?  @unique   // Komainu API `organization`
  komainuAccountNos  Json     @default("[]") // Komainu API account numbers
  jsmOrganizationId  String?  @unique   // JSM organisation
  jurisdiction       String   @default("") // UK | JE | AE | EU (entity servicing)
  isActive           Boolean  @default(true)
  channels           ClientChannel[]
  workItems          WorkItem[]
}
model ClientChannel {
  id        String @id @default(cuid())
  clientId  String
  kind      String // slack | email_domain | teams
  ref       String // Slack channel ID, email domain, Teams channel ID
  @@unique([kind, ref])
}
```

Seed no real client data. Admins maintain clients through a new admin tab, **Clients & Channels**.

### 7.2 WorkItem (the single queue)

```prisma
enum WorkItemKind { client_request alert daily_check_exception mtd_break oes_settlement fab_instruction kps_case vendor_ticket travel_rule_case screening_case scam_dust_case coin_review staking_exception nft_review report_task incident rca internal_task }
enum WorkItemState { open owned waiting_client waiting_vendor waiting_internal resolved closed }

model WorkItem {
  id               String        @id @default(cuid())
  kind             WorkItemKind
  title            String
  team             String        // "Team 1" | "Team 2" | "Team 3" | "All" (see Section 12)
  taskCode         String        // e.g. "CHK-01" (Section 12) or "CLIENT-Q"
  clientId         String?
  priority         String        @default("P2") // P0..P3
  riskScore        String?       // required before closure (Section 10.2)
  state            WorkItemState @default(open)
  ownerEmployeeId  String?
  sourceSystem     String        // komainu_api | slack | email | teams | jira | jsm | manual | system
  sourceId         String        // dedupe key in source
  ticketSystem     String?       // jsm | jira
  ticketKey        String?       // e.g. OTC-1234
  ticketUrl        String?
  slaPolicyId      String?
  clockStartedAt   DateTime      // event time in source, not ingest time
  firstResponseAt  DateTime?
  ownedAt          DateTime?
  resolvedAt       DateTime?
  resolutionNote   String?
  rootCause        String?       // controlled list (Section 10.2)
  exposureUsd      Float?        // where relevant (OES, FAB)
  metadata         Json          @default("{}")
  @@unique([sourceSystem, sourceId])
  @@index([state, team]) @@index([clientId]) @@index([ticketKey]) @@index([taskCode, state])
}
```

The existing `CommsThread` stays as the message store. Each client-question thread gets exactly one `WorkItem` of kind `client_request`, linked by `metadata.threadId`.

### 7.3 SLA policies and clocks

```prisma
model SlaPolicy {
  id            String  @id @default(cuid())
  code          String  @unique      // e.g. "CLIENT-Q-P1", "OES-FAIL", "FAB-ACK"
  description   String
  ownershipMins Int?    // time to ownership
  firstRespMins Int?    // time to first response
  resolveMins   Int?    // time to resolution
  calendar      String  @default("24x7") // "24x7" | "business_uk" | "business_<region>"
  warnAtPct     Int     @default(50)
  breachEscalationRole String @default("lead")
  version       Int     @default(1)
  isActive      Boolean @default(true)
}
model SlaEvent {
  id         String   @id @default(cuid())
  workItemId String
  kind       String   // ownership_warn | ownership_breach | first_response_warn | ...
  at         DateTime
  @@index([workItemId])
}
```

Targets are **CONFIRM-SLA-TARGETS**. Seed policies with `ownershipMins`, `firstRespMins` and `resolveMins` all `null`, plus a banner "SLA targets not set", until an admin sets them. The two exceptions are known values:
- MTD break closure: T+1, meaning resolve by end of the next business day after reporting;
- OES exchange contact: within 120 minutes of the settlement window start.

Business calendars use the existing `PublicHoliday` table (regions Global, EMEA, APAC).

### 7.4 Alerts (extend)

Extend `Alert`:

```prisma
  ruleCode      String            // e.g. "ALR-OES-01" (Section 11)
  dedupeKey     String            // unique per open alert
  workItemId    String?           // REQUIRED before acknowledge (Section 10)
  firstFiredAt  DateTime @default(now())
  lastFiredAt   DateTime @default(now())
  fireCount     Int      @default(1)
  escalatedAt   DateTime?
  autoResolvedAt DateTime?
  @@unique([ruleCode, dedupeKey, status])
```

Add `AlertRule`, which lets admins tune thresholds without a deploy. Every change is audit-logged, and rule changes need `admin`:

```prisma
model AlertRule {
  code        String  @id
  enabled     Boolean @default(false)
  severity    String  // low | medium | high | critical
  params      Json    // thresholds, windows, channels
  route       Json    // { businessHours: [...targets], outOfHours: [...targets] }
  version     Int     @default(1)
}
```

### 7.5 Heartbeats

```prisma
model SourceHeartbeat {
  source        String   @id  // "komainu_api.requests", "slack.client", "outlook.fab_ics", ...
  lastSuccessAt DateTime?
  lastRecordAt  DateTime?     // newest record timestamp seen
  lastCount     Int      @default(0)
  expectedEveryMins Int
}
```

### 7.6 Daily checks (replace generic items)

```prisma
model DailyCheckDefinition {
  code          String  @id          // "CHK-01" .. (Section 12)
  name          String
  team          String
  frequency     String               // daily | weekly | per_cycle
  dueByLocal    String               // "09:05" Europe/London unless stated
  evidenceSpec  Json                 // what counts as positive evidence
  ticketProject String               // default Jira project for exceptions
  confluenceUrl String
  version       Int     @default(1)
  isActive      Boolean @default(true)
}
```

Change `DailyCheckItem` as follows:
- add `definitionCode`, `evidence Json`, `recordCount Int?`, `dataAsOf DateTime?`, `skippedReason String?`, `skipApprovedBy String?` and `exceptionWorkItemIds Json @default("[]")`;
- replace the "one run per day" rule with per-definition, per-period runs (`@@unique([definitionCode, periodKey])`).

### 7.7 Time logging (client effort)

```prisma
model TimeLog {
  id          String   @id @default(cuid())
  workItemId  String
  clientId    String?
  bucketMins  Int      // 15 | 30 | 60 | 120 | 240
  loggedAt    DateTime @default(now())
  loggedById  String   // stored for data integrity; NEVER exposed in reports (H4)
}
```

### 7.8 Ticket links and IAI drafts

```prisma
model TicketLink {
  id         String @id @default(cuid())
  workItemId String
  system     String // jsm | jira
  key        String
  url        String
  role       String @default("primary") // primary | related
  @@unique([system, key, workItemId])
}
model IaiDraft {
  id          String   @id @default(cuid())
  workItemId  String
  triggerCode String   // alert rule that triggered it
  jiraKey     String?  // once created in IAI
  dueAt       DateTime // createdAt + 24h
  completedAt DateTime?
}
```

**STOP 2.** Provide the migration list and an ER summary.

---

## 8. PHASE 3 — Integrations

Branch: `phase-3-integrations`. Each connector is an `IntegrationAdapter` registered in `registry.ts`. Each one:
- reports `getHealth()`;
- updates `SourceHeartbeat`;
- goes through `CircuitBreaker.for(<source>)`;
- uses `src/lib/http/client.ts`.

### 8.1 Komainu API v1.6.0 (read-only)

- New folder `src/lib/integrations/komainu-api/`: `client.ts`, `types.ts` (generated by hand from the OpenAPI spec), `endpoints.ts`.
- Commit the OpenAPI file as `docs/phase1/komainu-openapi-1.6.0.json` for reference. Remove any example credential values it contains before committing, and check.
- **Auth:** `POST /v1/auth/token` with `{ api_user, api_secret }` from env `KOMAINU_API_USER` and `KOMAINU_API_SECRET`. Cache the bearer token until 60 seconds before `expires_in`. Base URL env `KOMAINU_API_BASE_URL`; the default in `.env.example` is `https://api-demo.komainu.io`.
- **Allowlist.** `endpoints.ts` exports a frozen list. The client refuses any other path or method.

| Method | Path | Used for |
|---|---|---|
| POST | `/v1/auth/token` | token only |
| GET | `/v1/requests` (filters `status`, `type`, `organization`, `account`, `workspace`, `page`, `page_size`) | pending and aged requests, automation failure, risk-pending linkage |
| GET | `/v1/requests/{request_id}` | detail |
| GET | `/v1/custody/transactions` (filters `status` PENDING, BROADCASTED, CONFIRMED or FAILED; `asset`, `wallet`, `organization`, `account`, `workspace`, `extRef`, pagination) | stuck and failed transactions, volume per client |
| GET | `/v1/custody/transactions/{transaction_id}` | detail |
| GET | `/v1/custody/wallets`, `/v1/custody/wallets/{id}` | wallet context |
| GET | `/v1/custody/wallets/eodbalances`, `/v1/custody/wallets/{id}/eodbalances` | EOD balances (up to 30 days back) for MTD and staking support |
| GET | `/v1/custody/whitelists`, `/v1/custody/whitelists/{id}` | whitelist context |
| GET | `/v1/custody/accounts`, `/v1/custody/workspaces`, `/v1/custody/assets` | reference data, client mapping (`account.name`, `account.serviced_by`, `organization`) |
| GET | `/v1/staking/ethereum/stakes`, `/v1/staking/solana/stakes`, `/v1/staking/rewards/daily` | staking checks |
| GET | `/v1/collateral/portfolios`, `/v1/collateral/operations`, `/v1/collateral/settlements` (+ `/{id}`) | OES and collateral settlement monitoring (`portfolio_type` EXCHANGE or FIREBLOCKS_OES; `started_at`, `completed_at`, `status`) |
| GET | `/v1/audit-logs` (`start_time`, `end_time`, max 31-day window; `category` ADMINISTRATION or TRANSACTIONS; cursor pagination) | configuration change alerts, event timing |

- **Explicitly excluded and never implemented:**
  - `POST /v1/requests` (create);
  - `GET /v1/requests/{id}/challenge`;
  - `POST .../confirm`, `.../cancel`, `.../approve` and `.../reject`;
  - `POST /v1/custody/transactions/estimate-fee`.
- **Polling cadence**, configurable in `AlertRule.params` or env:
  - requests every 60 seconds;
  - transactions every 120 seconds;
  - settlements every 60 seconds from 15 minutes before to 3 hours after each configured window, and every 10 minutes otherwise;
  - audit logs every 5 minutes (sliding window);
  - EOD balances daily at 07:00 UTC;
  - staking rewards daily at 07:30 UTC.

  Respect HTTP 429 with exponential backoff, and record `rateLimitRemaining` if headers exist.
- **Scope (CONFIRM-API-SCOPE).** The spec describes audit logs "for the workspace", which suggests API users may be workspace-scoped. Support **multiple API user credentials**, each tagged with its workspace or entity (env `KOMAINU_API_CREDENTIALS` as a JSON array of `{label, user, secretRef}`). Aggregate across them.
- **Settlement status values (CONFIRM-SETTLEMENT-STATUS).** The spec leaves `status` as an untyped string. Map statuses through a config table `SettlementStatusMap` (`raw`, mapped to `pending | in_progress | completed | failed | partial`). Treat unmapped values as `unknown`, and have them raise `ALR-CFG-02` (unmapped status seen).
- **Data handling.** Store only the fields needed. Redact addresses and hashes in logs (H8).

### 8.2 Jira and JSM (read plus limited write-back)

- **Credentials:** a dedicated Atlassian service account. Env `ATLASSIAN_BASE_URL=https://komainu.atlassian.net`, `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`.
- **Read:** Jira REST v3 search (JQL) for projects in 8.3, and JSM REST (`/rest/servicedeskapi/…`) for requests, organisations and request SLAs.
- **Write (allowlisted operations only):**
  - create issue or request;
  - add comment (internal comments by default; public JSM replies only via the Slack or JSM route in Section 9);
  - assign;
  - transition by transition id looked up at runtime;
  - set labels and allowlisted custom fields;
  - link issues.
  
  No deletes, and no project, workflow, field, scheme or automation changes (Section 0, rule 6).
- **Write-first semantics:** when a user changes owner or status in KOMmand Centre, call Jira or JSM first, then persist locally from the response. On failure, show the error and leave the local state unchanged.
- **Inbound sync:** poll every 2 minutes with `updated >= -5m`, idempotent on issue key and `updated`. Keep `ExternalTicketEvent` history.
- **Replace the old `src/lib/integrations/jira.ts` sync-to-CommsThread behaviour.** Jira issues become `WorkItem` rows, not comms threads.

### 8.3 Jira projects in scope

These projects are used by or relevant to Transaction Operations, taken from the team's recent activity and the Task Distribution page:

| Key | Name | Used for |
|---|---|---|
| OTC | Operation Transaction Changes | MTD breaks, EOD balance requests, internal transaction uploads, voids (reconciliation and ticketing only; Transaction Operations does not perform OTC trades) |
| TOPS | Transaction Operations | daily task tickets (for example the daily MTD check ticket) |
| VSR | (vendor service requests) | vendor RCA and issue tickets (Fireblocks, Ledger and others) |
| GXS | GX Service Management | GX issues raised by the team |
| IAI | Issues and Incidents Log | incidents (shared with other departments; see Section 10.4) |
| KPR | Police realisations | KPS K4 realisation and K3 return of assets |
| TOKENS | Token Listing | coin reviews |
| FOA | Finance Ops Approvals | billing and fee approvals (visibility only) |
| AO | Admin Operations | cross-team items (visibility only) |
| ITR, RCM | (as used) | CONFIRM-PROJECT-ROLES: confirm purpose before enabling |
| JSM service desk (new) | Transaction Operations client requests | client questions, created by Section 9 |

Project keys, issue types, transition ids and custom field ids are read at runtime. Store the mapping in `JiraProjectConfig` (admin-editable). Never hard-code them.

### 8.4 Slack

- Keep the existing bot token and signing-secret verification. Add the Events API (push) for near-real-time delivery, via `@slack/events-api`, which is already a dependency. Keep polling as a fallback every 5 minutes.
- Channel registry (`SlackChannel`) gains:
  - `clientId` (FK to `Client`);
  - `purpose` (`client | gx_notifications | vendor | internal_ops | alerts_out`).
- **Ingestion rules:** client channels are handled as in Section 9. For `gx_notifications`, do not skip bot messages: pass them to the Risk Signal parser (Section 11.4). Keep skipping `channel_join` and similar subtypes everywhere.
- **Outbound alerts:** post to the configured `alerts_out` channel with `chat.postMessage`. Each alert message includes the rule code, the WorkItem link and the ticket key. **No interactive approve or reject buttons ever.** The only allowed buttons are "Open in KOMmand Centre" and "Open ticket".

### 8.5 Microsoft 365 (Graph)

- Create an Entra app registration (documented for IT; not created by code) with **application** permissions `Mail.Read` and `ChannelMessage.Read.All`. Restrict mail access to named mailboxes only, with an Exchange application access policy. Env:
  - `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`;
  - `GRAPH_MAILBOXES` (JSON list of `{label, address, purpose}`);
  - `GRAPH_TEAMS_CHANNELS`.
- Replace the IMAP email adapter with a Graph mail adapter. Delete `imap-simple` usage.
- **Mailboxes (CONFIRM-MAILBOXES):**
  - the custody inbox (client instructions and emergency blotters);
  - the FAB ICS inbox (Section 12, FAB);
  - any vendor notification inbox receiving vendor portal emails.
- **Teams:** ingest configured channels as internal context only. Teams messages from clients (if any) follow Section 9 rules.
- **Vendor portal emails.** Vendor service desks email updates (for example the Ledger service desk sends from its own Atlassian site). Parse the sender, the ticket key in the subject (a pattern like `VSD-1234`) and the status line into `vendor_ticket` WorkItems linked to the matching VSR ticket where the key appears. Parsers per vendor are **CONFIRM-VENDOR-FORMATS**, built from redacted real samples.

### 8.6 Other sources (import-based in Phase 1)

| Source | Phase 1 approach |
|---|---|
| Chainalysis (screening, KYT alerts) | CSV or export import (`/admin/imports`), with a template defined from real exports (CONFIRM-CHAINALYSIS-EXPORT). An API connector is Phase 2. |
| Power BI (MTD report) | Link out. Optional CSV import of the daily variance extract (CONFIRM-MTD-EXTRACT). |
| Tatum (daily report) | Import or email-attachment parse (CONFIRM-TATUM) |
| Notabene | Adapter exists; flagged off (H11) |
| Fireblocks, Ledger | Not connected in Phase 1. Settlement and collateral data comes via the Komainu API; vendor status comes via vendor emails and status pages (the existing `status-page-poller.ts` may stay, behind flag `module.status_pages`). |

**STOP 3.** Provide the health endpoint output with all adapters `unconfigured` (no creds) and passing tests with mocks.

---

## 9. PHASE 4 — Client questions become tickets (Slack, email, Teams)

Branch: `phase-4-client-intake`.

### 9.1 Route selection (only one route active)

Flag `intake.slack.route` takes one of three values:
- `jsm_native`: JSM's own Slack integration creates requests;
- `kommand`: KOMmand Centre creates them;
- `off`.

Default is `off`. The two routes must never run together. If `jsm_native` is selected, KOMmand Centre **ingests** the JSM requests (Section 8.2) and does not create requests from Slack.

**Verification checklist before `jsm_native` can be enabled.** Record the evidence in `docs/phase1/jsm-slack-verification.md`. A human completes this; Claude Code creates the template only.
1. It works in Slack Connect channels shared with external client workspaces.
2. Client details auto-populate (requester mapped to the JSM organisation).
3. Clients see only public responses, never internal comments.
4. Thread replies update the same request.
5. The first Komainu reply is recorded as first response.
6. It behaves correctly when a client posts several questions in one message, or edits or deletes a message.

### 9.2 `kommand` route rules

Implement in `src/modules/intake/slack-intake-service.ts`.

1. Only channels with `purpose=client` and a linked `clientId` are eligible.
2. **Every new root message from an external user opens a JSM request.** An external user is one whose Slack `team_id` differs from Komainu's workspace id, or whose user id is in the client's mapped users. Over-capture is intentional.
3. A reply inside an existing thread adds a comment to the same request and never opens a new one. A root message within 2 minutes from the same external user in the same channel is appended to the previous request (burst merge). Make the window configurable.
4. Messages from Komainu staff or bots never open requests. The first Komainu staff reply in the thread sets `firstResponseAt` and posts an internal comment linking the Slack permalink.
5. Request fields:
   - summary = first 120 characters, sanitised;
   - description = full text plus the permalink;
   - organisation = the client's JSM organisation;
   - labels `source-slack` and `client-<slug>`;
   - priority from the rules in 9.4.
6. `clockStartedAt` is the Slack message `ts` converted to UTC.
7. **One-click "not a question" close**, for cases like "thanks" or an emoji. It requires a reason from a controlled list: `acknowledgement`, `social`, `duplicate` or `other (text)`. It is counted in metrics as `closed_non_actionable`.
8. Edits update the request description with an "edited" note. Deletes add an internal comment, and the request stays for audit.
9. **No AI classification** (H3). Rules only.

### 9.3 Email and Teams

- **Email** (custody inbox, via Graph): each new conversation (by `conversationId`) from an external sender whose domain maps to a `Client` opens a JSM request, with the same rules as Slack. Unknown external domains open a request tagged `client-unknown` for triage.
- **Teams:** if client Teams channels are configured, apply the same rules.

### 9.4 Priority rules (deterministic)

Priority is P1 when the message contains any keyword from a configurable list, with a default seed list for review:
- `urgent`;
- `stuck`;
- `not received`;
- `failed`;
- `withdraw`;
- `settlement`;
- `compromised`;
- `phishing`;
- `unauthorised`.

Everything else is P2. Leads can change priority afterwards (audit-logged). Never P0 automatically.

### 9.5 Current workaround to retire

The team's existing emoji-triggered Slack-to-VSR skill (an operator adds an `:inbox_tray:` reaction) must be switched off once intake is live, to avoid duplicates. Document this in the cut-over plan.

### 9.6 Acceptance tests

- An external root message creates exactly one request, with the correct organisation and a clock equal to the message ts.
- A staff message creates nothing and sets `firstResponseAt` on the open request.
- A thread reply comments on the same request.
- Burst merge works within the window.
- A bot message in a client channel creates nothing.
- A bot message in `gx_notifications` is passed to the Risk Signal parser.
- With `jsm_native` enabled, the `kommand` route creates nothing.
- A "not a question" close without a reason is rejected (HTTP 422).

**STOP 4.**

---

## 10. PHASE 5 — Tickets by default (enforcement)

Branch: `phase-5-ticket-enforcement`. All enforcement is **server-side**, in API routes and services. The UI only reflects it.

### 10.1 What raises a ticket automatically

| Trigger | Ticket target | Notes |
|---|---|---|
| Every alert that fires (Section 11) | JSM or Jira per `AlertRule.route.ticketProject` | Repeat firings update the same ticket via `dedupeKey` |
| Daily check item set to `issues_found` | One ticket per exception, in `DailyCheckDefinition.ticketProject` | The operator enters exceptions as structured rows (Section 12); each becomes a WorkItem and ticket |
| Client question (Section 9) | JSM | |
| FAB instruction email | Jira (project CONFIRM-FAB-PROJECT) | One ticket per instruction reference |
| Vendor portal update without a matching VSR | VSR | Created as a `vendor_ticket` WorkItem |
| Incident-criteria events (10.4) | IAI draft | Pre-filled |

### 10.2 What cannot be skipped

- **Acknowledge requires a ticket.** `POST /api/alerts/:id/acknowledge` returns 422 unless `workItemId` is set and its `ticketKey` exists. Auto-created tickets satisfy this.
- **Close requires a write-up.** Closing any WorkItem requires three things. Otherwise the API returns 422, and the same validation is applied before the Jira or JSM transition call:
  - `resolutionNote` of at least 20 characters;
  - `rootCause` from the controlled list below;
  - `riskScore`.
  
  Root-cause list (seed, admin-editable):
  - `client_error`;
  - `vendor_issue`;
  - `gx_defect`;
  - `data_issue`;
  - `process_gap`;
  - `configuration`;
  - `network_or_chain`;
  - `no_action_required`;
  - `duplicate`;
  - `other`.
  
  Risk score values follow the team's existing labelling (CONFIRM-RISK-SCORE-SCALE). The Task Distribution page states every ticket must carry a risk score.
- **No silent pass on daily checks.** Setting `pass` requires evidence per `DailyCheckDefinition.evidenceSpec`: at minimum `recordCount` (which may be 0 but must be present), `dataAsOf` (the source data timestamp) and the source name. A `pass` with `dataAsOf` older than the definition's freshness limit is rejected.
- **Skipping needs approval.** `skipped` requires a `skippedReason` and a second user with role `lead` or `admin` to approve (`skipApprovedBy`). The item stays `pending` until approved.
- **Resolution time.** Closing a `client_request` requires a time-log bucket (7.7), which drives client effort reporting.

### 10.3 Catching what slips through

- **Daily unticketed-work report** (job `report_unticketed`, 08:30 UK). It lists:
  - client-channel root messages from external users with no WorkItem;
  - active alerts with no WorkItem;
  - daily check items `issues_found` with no exception WorkItems;
  - WorkItems whose ticket write-back failed.
  
  The report posts to the Transaction Operations alerts channel and appears on the Morning Board. A non-empty report raises `ALR-TKT-01`.
- **Reconciliation job** (hourly): compare open WorkItems with open Jira and JSM tickets by key, and flag divergence (`ALR-TKT-02`).

### 10.4 IAI drafts (shared log; needs owner agreement)

- Flag `iai.drafts.enabled`, default `false` (CONFIRM-IAI-OWNER). When on, these events create an `IaiDraft` and a pre-filled IAI Jira issue in its draft or initial state, with a due time of 24 hours:
  - `ALR-OES-01` unresolved at end of day;
  - `ALR-RSK-06` (KYT hit after broadcast);
  - `ALR-CFG-01` (tap rule or whitelist change flagged as unexpected);
  - `ALR-KPS-01`;
  - any P0 or P1 SLA breach on a client request;
  - any `ALR-FAB-05`.
- If not completed in 24 hours, `ALR-IAI-01` escalates to role `admin` (Head of Transaction Operations).

### 10.5 Acceptance tests

One test per rule in 10.2 (API returns 422 with a clear message), plus the report job output on seeded fixtures.

**STOP 5.**

---

## 11. PHASE 6 — Alerting engine

Branch: `phase-6-alerting`.

### 11.1 Engine design

- Implement `src/modules/alerting/engine.ts`. Rules are TypeScript evaluators registered by `code`, with parameters from `AlertRule.params`.
- Each evaluator returns `AlertCandidate[]`, where an `AlertCandidate` is `{dedupeKey, severity, title, detail, workItemSeed, exposureUsd?}`.
- The engine then:
  1. upserts the open alert by `(ruleCode, dedupeKey)`;
  2. creates or updates the WorkItem and ticket (Section 10.1);
  3. routes the notification (11.3);
  4. schedules escalation;
  5. **auto-resolves** when the evaluator stops returning the candidate for two consecutive runs, adding a ticket comment "condition cleared at <time>". Auto-resolve never closes the ticket; closure still needs the write-up.
- Evaluators run from the worker (job `evaluate_alerts`, every 60 seconds; heavy rules may declare their own cadence).
- **All rules ship `enabled=false`.** Admins enable them one by one after thresholds are confirmed.
- **Design rules:**
  - every rule has an owner team, a clock and an escalation step;
  - silence is an alert (heartbeats);
  - alerts are informational: no action buttons, H1.

### 11.2 Alert catalogue

"Clock" is the default value in `params`. Values marked CONFIRM are placeholders that block enabling the rule.

**FAB (ICS repo, MVP0: email-driven, manual).** Source: the Graph mailbox `fab_ics` plus the FAB trade register and settlement log (Section 12, TASK-FAB).

| Code | Name | Trigger | Clock / threshold | Severity | Dedupe key | Auto-resolve | Ticket |
|---|---|---|---|---|---|---|---|
| ALR-FAB-01 | FAB instruction received | New email in `fab_ics` whose subject or body matches a TRD_NTF or STL_INS template (parser CONFIRM-FAB-TEMPLATES) | immediate | medium | message id | on ACK or NACK recorded | FAB project |
| ALR-FAB-02 | FAB instruction not acknowledged | ALR-FAB-01 open and no MSG_STS ACK or NACK sent from the mailbox | CONFIRM-FAB-ACK-MINS | high | instruction ref | on ACK or NACK | same ticket |
| ALR-FAB-03 | FAB instruction after cut-off | Instruction received after 15:00 Europe/London | immediate | medium | instruction ref | n/a (informational; add "rolls to next day" comment) | same ticket |
| ALR-FAB-04 | FAB NACK sent | Outbound MSG_STS NACK detected | immediate | medium | instruction ref | when a corrected instruction arrives | same ticket |
| ALR-FAB-05 | FAB settlement failed | STL_STS FAILED sent, or settlement log row marked FAILED | immediate | critical | instruction ref | never (needs write-up) | same ticket, plus IAI draft |
| ALR-FAB-06 | FAB deposit not received by value date | OPEN or MARGIN RECEIVE instruction whose value date is today, with no inbound recorded by the cut-off | CONFIRM-FAB-VALUE-DATE-CUTOFF | high | instruction ref | inbound recorded | same ticket |
| ALR-FAB-07 | FAB inbound KYT lock | Inbound to a FAB collateral wallet with a KYT fail or escalation (from Chainalysis import, or a manual flag in the settlement log) | immediate | critical | tx ref | Compliance outcome recorded | same ticket |
| ALR-FAB-08 | FAB fee buffer low | Fee reserve below threshold. Source: existing exchange-account fee alerting emails (CONFIRM-FEE-ALERT-FORMAT) or a manual balance entry | CONFIRM-FEE-THRESHOLDS | high | wallet ref | balance back above threshold | same ticket |

Note: the FAB MVP0 settlement process page is marked **draft, not yet operational**. The maker for outbound settlements is still open. Ship all FAB rules disabled.

**OES and collateral settlement.** Source: Komainu API `/v1/collateral/settlements`, `/v1/collateral/operations`, `/v1/requests`, `/v1/custody/transactions`.

Settlement windows are config (`OesWindow` table: `exchange`, `cronUtc`, `durationMins`, `referenceTz`). Seed:
- Deribit 09:15–09:30 UTC;
- Bybit every 6 hours from 00:00 UTC;
- OKX 09:00.

The OKX reference time conflicts between documents: UTC in one, "9am UK" in the other (CONFIRM-OES-WINDOWS). Deribit is moving into Coinbase; confirm its window is unchanged (CONFIRM-DERIBIT).

| Code | Name | Trigger | Clock | Severity | Dedupe key | Auto-resolve | Ticket |
|---|---|---|---|---|---|---|---|
| ALR-OES-01 | Settlement failed | Settlement mapped status `failed` or `partial` for today's window | immediate | critical | settlement id | status `completed` | TOPS (CONFIRM) |
| ALR-OES-02 | Settlement stuck | Status `in_progress` more than 60 minutes after window start | 60 min | high | settlement id | `completed` | same |
| ALR-OES-03 | Settlement cycle did not run | No settlement record for an expected portfolio or cycle by window start + N minutes. Expected set = active portfolios by `type` and `exchange` | 30 min (suggested) | high | portfolio + window date | record appears | same |
| ALR-OES-04 | Settlement awaiting approval | Request of type COLLATERAL_OPERATION_* or a transaction to or from settlement wallets still PENDING longer than N minutes (the automated approver has failed) | 15 min (suggested) | high | request id | no longer PENDING | same |
| ALR-OES-05 | Exchange not contacted | ALR-OES-01 or 03 open and no ticket comment tagged `exchange-contacted` within 120 minutes of window start | 120 min | critical | alert id | tag added | same |
| ALR-OES-06 | End-of-day failure: client exposure | ALR-OES-01 still open at 17:00 Europe/London. The ticket gets a task "confirm client understands exchange exposure" with the exposure amount recorded (`exposureUsd`) | 17:00 | critical | settlement id | ticket closed | same, plus IAI draft |
| ALR-OES-07 | Collateral operation failed | Collateral operation status failed | immediate | high | operation id | n/a | same |

**Risk-flagged transactions awaiting a human** (read-only; approval stays in GX, H1). Source: the Risk Signal source (11.4), joined to Komainu API requests or transactions by request or transaction id.

| Code | Name | Trigger | Clock | Severity | Dedupe key | Auto-resolve | Ticket |
|---|---|---|---|---|---|---|---|
| ALR-RSK-01 | Medium risk pending | Risk level Medium and request still PENDING | CONFIRM-RSK-MED-MINS | high | request id | not PENDING | JSM or TOPS (CONFIRM) |
| ALR-RSK-02 | High risk pending | Risk level High and PENDING. The rule text must show whether it is a KYT trigger (Rules 1 and 5, which need Compliance to clear first) | CONFIRM-RSK-HIGH-MINS; Compliance response target 2 hours in business hours (proposed, not ratified) | critical | request id | not PENDING | same |
| ALR-RSK-03 | Requires Escalation | Risk level "Requires Escalation" (the tier above High) | immediate | critical | request id | not PENDING | same |
| ALR-RSK-04 | Emergency Stop active | An Emergency Stop signal (Rule 12) is seen for any client or globally | immediate | critical | scope | stop cleared | same, plus notify lead and admin |
| ALR-RSK-05 | Risk rule fallback | Risk reason "No Rule configurations found for the Risk Check" | daily digest 08:00 | medium | client + check | config fixed | AO (CONFIRM) |
| ALR-RSK-06 | KYT hit after broadcast | Rule 5 outcome on a broadcast transaction | immediate | critical | tx id | Compliance outcome | same, plus IAI draft |
| ALR-RSK-07 | Low risk still pending | Request PENDING, risk Low, older than N minutes (auto-approval failed) | 10 min (suggested) | high | request id | not PENDING | same |
| ALR-RSK-08 | Pending, not risk-scored | PENDING outbound in cold workspaces, internal transfers or Komainu service-provider wallets, which are excluded from the risk engine | CONFIRM | high | request id | not PENDING | same |
| ALR-RSK-09 | Staking action pending | Staking transactions, which are always High by design and still require blotters. Kept as their own category so they do not flood ALR-RSK-02 | CONFIRM | medium | request id | not PENDING | same |

Risk rule mapping follows the **current approved flow**: all triggers treated as High. The 28 August 2026 RiskCo proposal to move Rules 7 to 11 (and possibly 2 and 3) to Medium is **not ratified**, and it is internally inconsistent on Rules 2 and 3. Implement the mapping as config `RiskRuleTier` (rule number → tier) seeded with all rules at High, so the new mapping can be switched on after approval without a code change (CONFIRM-RISKCO).

**Configuration, KPS, transactions and hygiene.**

| Code | Name | Trigger | Source | Clock | Severity | Ticket |
|---|---|---|---|---|---|---|
| ALR-CFG-01 | Tap rule, whitelist or risk-parameter change | Audit log category ADMINISTRATION with an event matching the configured patterns (CONFIRM-AUDIT-EVENTS). Every change creates a review ticket; Control 3.3 covers parameter change control | Komainu API audit logs | immediate | high | TOPS |
| ALR-CFG-02 | Unmapped external status | Unknown settlement or request status value seen | adapters | immediate | medium | internal |
| ALR-KPS-01 | KPS realisation above RiskCo threshold | KPR ticket or realisation request with USD value at or above the threshold (seed $1,000,000; CONFIRM) and no RiskCo approval link | Jira KPR + Komainu API | before execution | critical | KPR, plus IAI draft |
| ALR-TX-01 | Transaction failed | Transaction status FAILED | Komainu API | immediate | high | OTC or TOPS (CONFIRM) |
| ALR-TX-02 | Transaction stuck | PENDING or BROADCASTED older than the per-asset threshold (`AssetThreshold` table; seed 120 minutes; CONFIRM) | Komainu API | per asset | high | TOPS |
| ALR-TR-01 | Travel rule case ageing | Existing 24-hour (amber) and 48-hour (red) logic | existing | 24h, 48h | medium, high | existing |
| ALR-SLA-01..06 | SLA warn and breach | Ownership, first response and resolution warn (at `warnAtPct`) and breach, for every WorkItem with an `SlaPolicy` | SLA engine | per policy | warn medium, breach high (P0 and P1: critical) | same ticket |
| ALR-CHK-01 | Daily check not done | A `DailyCheckDefinition` due by `dueByLocal` with no completed item | daily checks | due time | high | TOPS |
| ALR-TKT-01 | Unticketed work found | Section 10.3 report is non-empty | report | 08:30 | high | internal |
| ALR-TKT-02 | Ticket divergence | Section 10.3 reconciliation | job | hourly | medium | internal |
| ALR-IAI-01 | IAI draft overdue | 10.4 | job | 24h | high | IAI |
| ALR-VND-01 | Vendor ticket no update | VSR or vendor WorkItem with no vendor update for N business hours (CONFIRM) | Jira + vendor emails | CONFIRM | medium | VSR |
| ALR-HB-* | Heartbeat lost | `SourceHeartbeat.lastSuccessAt` older than 2 × `expectedEveryMins`, or `lastRecordAt` stale beyond a source-specific limit (for example no settlement record at all for 24 hours) | heartbeats | per source | high (worker: critical) | internal |

### 11.3 Routing and escalation

- **Business hours** (per `SlaPolicy.calendar`): post to the Slack `alerts_out` channel and in-app. For high and critical alerts, also mention the owning team's lead from Task Distribution (Section 12).
- **Out of hours:** notify the on-call primary from `OnCallSchedule` (by team and date) by Slack DM and email. If there is no acknowledgement within 15 minutes for critical alerts (configurable), notify the on-call secondary and the lead.
- The tech team's existing paging is unchanged. Do not integrate PagerDuty in Phase 1.
- **Escalation ladder** per rule: `[{afterMins, notifyRole}]` in `AlertRule.params`.
- **Quiet rules:**
  - identical `dedupeKey` never re-notifies within 15 minutes, but `fireCount` increments;
  - daily digests for medium-severity config rules.

### 11.4 Risk Signal source (CONFIRM-RISK-SOURCE)

The Komainu API has **no risk score field**. Risk levels must come from GX. Implement the interface:

```ts
interface RiskSignalSource {
  name: string;
  poll(since: Date): Promise<RiskSignal[]>;
}
type RiskSignal = {
  requestId?: string;
  transactionId?: string;
  level: "low" | "medium" | "high" | "requires_escalation";
  rules: number[];
  reasons: string[];
  observedAt: Date;
  raw: string;
};
```

Two implementations:
1. `SlackGxNotificationSource` parses GX bot posts in the `gx_notifications` channel. **Do not write the parser until at least 10 redacted real samples are provided** in `src/__tests__/fixtures/gx-risk/`. Ship it with a failing-safe behaviour: messages that don't parse produce an `ALR-CFG-02`-style "unparsed risk notification" alert.
2. `GxInternalFeedSource` is a stub, pending Engineering (it may be a database view or internal endpoint).

Never infer risk locally (H5).

### 11.5 Acceptance tests

For each rule, write tests for:
- positive trigger;
- no trigger below threshold;
- dedupe;
- auto-resolve after two clean runs;
- ticket created or updated;
- routing (business and out of hours).

Use frozen clocks (`vi.setSystemTime`) and Komainu API fixtures. Also test that a rule with a CONFIRM placeholder cannot be enabled: the admin API returns 422 listing the missing params.

**STOP 6.**

---

## 12. PHASE 7 — Complete coverage of daily work

Branch: `phase-7-daily-coverage`. You may split it into sub-PRs by team.

Every recurring task below must be runnable from KOMmand Centre. Sources:
- the Confluence **Transaction Operations Task Distribution** page (TOP space), which gives team ownership and the 09:05 UK morning call;
- the numbered daily checks in the TOP space, each with a process page and an "Explainer" page.

Link each definition to its Confluence page by searching the TOP space for the exact title (store the URL in `DailyCheckDefinition.confluenceUrl`). Do not copy procedure text into code.

**Team ownership.** Teams are fixed, with no rotation. Store team lead mapping in config (`TeamConfig`: team → lead employeeId, deputy employeeId), not in code.

**Numbering gap (CONFIRM-CHECK-GAPS).** TOP has checks 1–13, 15–17, 21 and 22. Numbers 14 and 18–20 were not found. Ask whether they exist before declaring coverage complete.

**Common template.** Every check or task gets:
- (a) a `DailyCheckDefinition` (or a recurring `internal_task` WorkItem for non-check tasks);
- (b) an automated data pull where a source exists;
- (c) positive-evidence capture;
- (d) structured exception entry, where each exception row becomes a WorkItem and ticket;
- (e) a due-time alert (`ALR-CHK-01`);
- (f) a card on the owning team's board.

Evidence specs below list the minimum fields.

### Team 1

**CHK-01 Stuck Transactions** (daily; Team 1)
- Source: Komainu API transactions with status PENDING or BROADCASTED, older than the per-asset threshold (`AssetThreshold`).
- Evidence: count of transactions scanned, count stuck, data timestamp.
- Exceptions: one WorkItem per stuck transaction (kind `daily_check_exception`) → TOPS. Include asset, age and a redacted reference.
- Alerts: ALR-TX-02 runs continuously, so the daily check becomes a review of open items.
- Known issues:
  - there is no documented escalation clock (findings register CF-16), so make it a config value;
  - there is no degraded or sunset asset list (CF-26), so provide an `AssetStatus` admin table and let the operator mark "known degraded", which suppresses the ticket with a reason.

**CHK-09K KPS, K4 realisation and K3 return of assets** (daily; Team 1; RESTRICTED explainer)
- Source: KPR Jira project plus Komainu API requests and transactions for KPS wallets. Wallet list is admin config; the KPS MTD wallets are part of CHK-02.
- Evidence: open KPR items reviewed, count.
- Exceptions: WorkItem kind `kps_case` → KPR.
- Alert: ALR-KPS-01 (RiskCo threshold).
- Access: KPS views require a new permission `kps:view`, limited to named users. Mirror the RESTRICTED status of the explainer.
- Known issue: KPS VTHO transactions are excluded from screening without recorded rationale (CF-03). Show a banner on the KPS view linking the finding. Do not change the screening logic.

**CHK-10 OES and OKX collateral settlement monitoring** (per settlement window; Team 1)
- Source: Komainu API settlements, operations and requests. Windows from `OesWindow`.
- Evidence per window: portfolios expected, settlements seen, completed, failed, in progress, and data timestamp.
- Exceptions: ALR-OES-* WorkItems → TOPS.
- UI: the existing `src/app/settlements` page reworked to read from the API, with one row per portfolio per window and the status timeline. Remove the dashboard's maker/checker "approval" actions. Settlement approvals happen in the platforms (H1). The page becomes a read-only matching view with notes.
- Client comms: on ALR-OES-06, show the client-notification template from Confluence "FB OES Collateral Settlement Monitoring", and **require the operator to choose an exposure band**. The findings register (CF-39) notes the template uses the same "minor technical issues" wording for all exposure sizes. Link that finding; do not rewrite the template.
- Known issues:
  - the minimum settlement threshold for skipped instructions does not exist (CF-37, CF-41), so leave the "skipped above threshold" check disabled until it is set;
  - there is no position if OKX misses its 2-hour remediation (CF-38), so the ALR-OES-05 escalation ends at the Head of Transaction Operations.

**CHK-11 Production Issues** (daily; Team 1)
- Source: existing Incidents module plus GXS and VSR Jira projects.
- Evidence: open production issues reviewed, count.
- Exceptions: incidents write back to Jira (GXS or VSR) and, when criteria are met, create IAI drafts.
- Change: the incident "timeline updates" must post as Jira comments.

**CHK-12 Outstanding RCA Requests** (daily; Team 1)
- Source: VSR Jira project, plus vendor portal emails (Section 8.5).
- Evidence: open RCAs, overdue count.
- Exceptions: ALR-VND-01 for no vendor update.
- Change: `src/app/api/rca/tickets/route.ts` currently only reads the Komainu Jira site. Vendor tickets on other sites (for example the Ledger service desk, which emails updates) come via email parsing instead. Do not store credentials for vendor Atlassian sites.
- Keep the premature-closure dispute workflow, but make "post comment to provider" draft-only, sent by a human.

**CHK-17 Cold Staking Ops (T-1) Flagged Correctly** (daily; Team 1)
- Source: Komainu API workspaces (cold) plus the staking wallet config.
- Evidence: T-1 cold staking operations count, and count flagged correctly.
- Exceptions → TOPS. The procedure is in Confluence; the dashboard records the result and exceptions only.

**CHK-08 Weekly Validator Checks** (weekly, Monday; Team 1)
- Source: manual entry in Phase 1.
- Evidence: validators checked (count), date.
- Known blocker: there is **no approved validator set** documented (CF-10, CF-24). Provide an `ApprovedValidator` admin table, empty, and show "approved validator set not defined: control 5.1 cannot be evidenced" until it is populated.

**TASK-FAB FAB ICS repo (MVP0)** (event-driven; Team 1)
- Source: the Graph mailbox `fab_ics`.
- Build three things:
  - an **instruction register** (TRD_NTF and STL_INS parsed into rows: message type, TradeReference or AgreementReference, direction, asset, amount, value date, received time, ACK/NACK sent time);
  - a **settlement log** (RECEIVED, INITIATED, COMPLETED or FAILED, with tx hash stored redacted in logs);
  - a daily "report to FAB sent" task.
- Alerts: ALR-FAB-01 to 08.
- Tickets: one per instruction reference (CONFIRM-FAB-PROJECT).
- Status: the MVP0 settlement process is **draft, not operational**, and the outbound maker role is unresolved, so ship the whole FAB module behind flag `module.fab` (default `false`).
- FAB inbound collateral is not risk-scored (the risk engine scores outbound only), so inbound relies on ALR-FAB-07 (KYT).

### Team 2

**CHK-02 Daily MTD Variances** (daily for client assets, Team 2; weekly for dev assets, Team 3)
- Source: the Power BI MTD report (link) plus the optional CSV import of variances (CONFIRM-MTD-EXTRACT); EOD balances from the Komainu API for cross-checks.
- Evidence: variance rows reviewed, count, and report data date.
- Exceptions: each break becomes an `mtd_break` WorkItem → OTC with the break type. The break type list comes from Confluence page "2.3 OTC Break Types"; store it as an admin-editable enum table.
- SLA: resolve by T+1 business day from reporting.
- Close the daily TOPS MTD ticket automatically when all breaks for the day are resolved or explained, as a comment plus transition. It is the Team 2 lead's responsibility per Task Distribution.
- Known issue: GX transaction status can be wrong versus the chain (CF-18). Show "GX status vs chain unverified" on break items.

**CHK-03 Outstanding Requests in GX** (daily; Team 2)
- Source: Komainu API `GET /v1/requests?status=PENDING` (and CREATED or BLOCKED), aged.
- Evidence: count by type and age band.
- Exceptions: requests past threshold → TOPS.
- **Read-only.** No action on requests (H1).

**TASK-OTC OTC Ticket Check** (daily; Team 2)
- Source: OTC Jira.
- Evidence: open OTC tickets reviewed; count unassigned and count overdue.
- UI: an OTC queue view with filters.
- Notification: when an OTC ticket is assigned to the Head of Transaction Operations, send a Slack DM and an in-app notification (standing preference). Make this configurable per user: `notify.on_assign.projects`.

**CHK-06 Scam and Dust** (daily; Team 2)
- Source: existing Screening module (classifications), plus the Chainalysis import.
- Evidence: new candidates reviewed, and count classified as scam, dust or legitimate.
- Exceptions: each block decision is a `scam_dust_case` WorkItem → TOPS, with the client advisory recorded. Where a client overrides Komainu's scam assessment (CF-35), require the client decision to be attached before closure.
- Known issue: GX auto-blacklists dust senders with no documented reversal path (CF-34). Add a "possible false positive" flag that opens a ticket to Tech.

**CHK-07 NFTs Pending Approval** (daily; Team 2)
- Source: manual in Phase 1 (CONFIRM-NFT-SOURCE: GX view or API).
- Evidence: count pending.
- Exceptions → TOPS.
- Note: this is an NFT review task, not a transaction approval. KOMmand Centre records review status only.

**CHK-13 Outstanding Coin Reviews** (daily; Team 2)
- Source: existing Tokens module, **synced two-way with the TOKENS Jira project**. The Jira ticket is the record; the Tokens module becomes a view plus structured fields.
- Disable the AI research and discovery features (H3).
- Evidence: open reviews, and overdue count.

### Team 3

**CHK-09 Travel Rule Check** (daily; Team 3)
- Source: the Notabene adapter, **flag off** (H11) until the breach investigation closes. Meanwhile use the existing process with a CSV import of the reconciliation output.
- Evidence: transactions in scope, matched, unmatched, and data date.
- Exceptions: `travel_rule_case` WorkItems, keeping the existing 24h and 48h ageing.
- Known issues to surface, not fix:
  - "Failed – Unresponsive VASP" terminal state with no risk acceptance (CF-05);
  - OKX collateral settlements as a recurring unresponsive counterparty (CF-06);
  - local reporting thresholds undocumented (CF-07);
  - the macro fails silently on a filename mismatch (CF-22): the import must reject files whose name or date does not match the expected pattern.

**CHK-05 Inbound Transaction Reporting** (daily; Team 3)
- Source: the Power BI inbound threshold dashboard (link) plus a CSV import of breaches (CONFIRM-INBOUND-EXTRACT); client attested thresholds stored per `Client`.
- **Positive evidence is mandatory**: the record count and data date of the dashboard extract. A blank result is not a pass (CF-32).
- Exceptions → Jira (CONFIRM: the separate board referenced in CF-30).
- Known issues:
  - control 4.2 and this check describe different mechanisms (CF-30);
  - thresholds have no review cadence (CF-31). Add `thresholdReviewedAt` per client, and alert when it is older than 12 months (CONFIRM).

**CHK-04 Transaction Screening (Chainalysis)** (daily; Team 3)
- Source: Chainalysis import (8.6).
- Evidence: transactions screened, alerts, data date.
- Exceptions: `screening_case` → TOPS or the Compliance project (CONFIRM).
- Known limits: zero-value or no-hash transactions cannot be screened (CF-04), so count them separately. Staking is excluded (CF-01), so show the exclusion count.

**CHK-16 Staking Rec and Partner Confirmations** (daily; Team 3)
- Source: Komainu API ETH and SOL stakes, daily rewards and EOD balances; partner confirmations recorded manually per partner.
- Evidence: wallets reconciled, variances, and confirmations received versus expected.
- Exceptions: `staking_exception` → TOPS.
- Known issues:
  - the control reconciles activity, not position (CF-09);
  - ADA staked balance exceeds total on three wallets (CF-17);
  - duplicate matched balance records (CF-19).
  
  Add a "position check" computing staked ≤ total per wallet, flagging violations.

**CHK-21 Staking Rewards Paid as Expected** (daily; Team 3)
- Source: Komainu API `/v1/staking/rewards/daily`, plus the existing reward-heartbeat model (`StakingWallet`) for chains the API does not cover.
- Evidence: wallets expected, rewards seen, and overdue count.
- Exceptions → TOPS.

**CHK-22 Newly Staked Accounts** (daily; Team 3)
- Source: Komainu API stakes, as the diff against the previous day.
- Evidence: count of new stakes.
- Exceptions: new stakes missing expected config → TOPS.

**CHK-15 Tatum Check** (daily; Team 3)
- Source: Tatum report import (CONFIRM-TATUM).
- Evidence: report received, data date, exception count.
- Exceptions → TOPS.

**TASK-AVIVA Aviva daily balance report and Ripple Custody intents** (daily; Team 3)
- Report: a task with a due time, and evidence "report sent" (timestamp plus recipient list reference, no attachment storage).
- Ripple Custody intents: Phase 1 records review status only (manual). The Ripple Custody Transaction Operations SOP requires two Transaction Operations approvers in the Ripple platform, and approvals stay there (H1).
- Exceptions → TOPS.

### All teams

**TASK-CLIENTQ Client questions** (continuous): Section 9.

**TASK-VENDOR Vendor tickets** (continuous): Sections 8.5 and 11.2 (ALR-VND-01), CHK-12.

**TASK-BILL Billing and fee approvals** (as they arise)
- Source: FOA Jira (visibility only).
- A KOMmand Centre view of FOA items where Transaction Operations is involved. Confluence "Billing Reports – Client Trading Position and Fees Approvals" defines the process.
- No approval actions in KOMmand Centre.

**TASK-RISKVIEW Risk-flagged transactions awaiting a human** (continuous)
- Section 5.2 (reworked `TransactionConfirmation`) plus ALR-RSK-*.
- Read-only. Approval stays in GX.

**TASK-MORNING Morning call and handover** (daily 09:05 UK): Section 14.

### Coverage acceptance

Build a coverage test `coverage-all-daily-tasks`. It asserts that a `DailyCheckDefinition` or recurring task definition exists for every code in this section, each with:
- `team`;
- `dueByLocal`;
- `evidenceSpec`;
- `ticketProject`;
- `confluenceUrl` (may be a CONFIRM placeholder).

The test fails if a code is missing.

**STOP 7.** Provide a coverage matrix screenshot or table generated from the DB.

---

## 13. PHASE 8 — Metrics and SLAs

Branch: `phase-8-metrics`.

### 13.1 Principles

- **Team and client level only.** No metric, report, export or API response may break results down by individual (H4). `TimeLog.loggedById` and `WorkItem.ownerEmployeeId` must not appear in any aggregate output. Test: `no-per-person-metrics-in-reports` scans report and export responses for employee ids and names.
- **Clocks start at source time** (`clockStartedAt`), not ingest time.
- **Business-hours calendars** apply only where the `SlaPolicy.calendar` says so. OES and risk alerts default to 24x7.

### 13.2 Definitions (implement in `src/modules/metrics/definitions.ts`, with unit tests per formula)

| Metric | Definition |
|---|---|
| Time to ownership | `ownedAt − clockStartedAt` |
| Time to first response | `firstResponseAt − clockStartedAt` (client requests: first Komainu reply in the client channel or email) |
| Time to resolution | `resolvedAt − clockStartedAt` |
| SLA attainment % | share of WorkItems in period whose measured time ≤ policy target; excludes `closed_non_actionable` from the denominator but reports its count |
| Breach count | WorkItems with any breach `SlaEvent` in period |
| Backlog age | open WorkItems by age band (<1h, 1–4h, 4–24h, 1–3d, >3d) |
| Client effort (hours) | Σ `TimeLog.bucketMins`/60 by client, labelled "logged effort" |
| Client activity volume | per client: requests created; transactions and requests from the Komainu API (by `organization` and `account`); Slack threads. Labelled "volume, not effort" |
| Logging coverage % | closed client requests with a TimeLog ÷ closed client requests |
| Alert load | alerts fired by rule and severity; mean time to acknowledge; auto-resolved share |
| Check completion | on-time rate per `DailyCheckDefinition`; skipped count |
| MTD break closure | share closed within T+1 business day |
| OES window health | windows on time, failed, stuck, or not run, by exchange |
| Unticketed work | daily count from Section 10.3 (target 0) |

### 13.3 Reports and UI

- `/metrics` pages:
  - **Responsiveness** (by team, channel and priority);
  - **Clients** (effort and volume ranked, with month-on-month trend);
  - **Operations health** (checks, OES, alerts, MTD);
  - **Hygiene** (logging coverage, unticketed work, skipped checks).
- Monthly export (CSV and PDF via the existing `src/lib/pdf-report.ts`), restricted to `lead` and `admin`, audit-logged (the existing export governance).
- Every chart shows data freshness ("as of" plus source heartbeat status).
- Keep targets visible; show "target not set" where a CONFIRM-SLA-TARGETS value is missing.

**STOP 8.**

---

## 14. PHASE 9 — The single work interface (UI)

Branch: `phase-9-work-ui`.

### 14.1 Navigation (replace the current sidebar)

1. **Work**: the unified queue, with default filter "my team, open". Filters:
   - team (1, 2, 3, All);
   - kind;
   - client;
   - priority;
   - SLA state (ok, warn, breach);
   - ticket project;
   - owner (me, unassigned, team).

   Each row shows:
   - title;
   - kind icon;
   - client;
   - live SLA timer;
   - ticket key (link);
   - owner;
   - last activity.
2. **Team boards**: Team 1, Team 2 and Team 3, each showing its daily checks (status, due time, evidence) and open exceptions.
3. **Daily checks**: all definitions for today, with evidence capture and structured exception entry.
4. **Alerts**: active by severity, with rule code, fire count, linked WorkItem and ticket.
5. **Clients**: per client, open items, SLA status, recent activity, effort (team-level) and channels.
6. **Settlements (OES)**, **Travel rule**, **Staking**, **KPS** (restricted), **FAB** (flagged), **Coin reviews**, **Incidents and RCA**.
7. **Metrics**.
8. **Morning board**.
9. **Admin**: clients and channels, SLA policies, alert rules, check definitions, team config, Jira project config, imports, feature flags, audit log and health.

Remove from navigation:
- approvals (deleted);
- USDC ramp, AI briefing and compliance bot (flags off);
- scoring and activity (flags off);
- the market ticker (flag off).

### 14.2 Work item detail

- **Header:** title, kind, client, priority, state, SLA timers, ticket key.
- **Timeline:** source messages (Slack, email or Teams, with permalinks), ticket comments, alerts and state changes.
- **Actions:**
  - take ownership;
  - reassign;
  - change state (writes to the ticket first);
  - add internal note (posts as an internal Jira comment);
  - log time;
  - link related ticket;
  - close (requires the write-up per 10.2).
- **No transaction actions of any kind** (H1).

### 14.3 Morning board (09:05 UK)

- Built only from tickets and WorkItems. It shows, for each team lead:
  - yesterday's checks not completed;
  - open exceptions with age;
  - blockers (items in a `waiting_*` state, with reason);
  - SLA breaches in the last 24 hours;
  - active alerts;
  - FAB and OES status.
- **Handover:** if a lead is absent (PTO record or manual toggle), they must select a covering member and write a handover note before 09:00. That note posts as a comment on each of the lead's open tickets. If the note is missing at 09:00, the lead and the Head of Transaction Operations are notified.
- A "no verbal-only updates" banner: items not on a ticket do not appear.

### 14.4 Responsiveness UX

- Live SLA timers via the existing SSE (`src/lib/sse.ts`). The queue re-orders by time remaining.
- A sound or desktop notification for new P1 client requests and critical alerts, if the user enables browser notifications.
- A **"first response" quick action** posts a reply into the client's Slack thread or email. It is a human-written message; templates are allowed, AI is not.

**STOP 9.**

---

## 15. PHASE 10 — Jira rationalisation support (read-only tooling)

Branch: `phase-10-jira-inventory`.

- Script `scripts/jira-inventory.ts` (read-only). For each project in 8.3 it lists:
  - boards;
  - filters owned by Transaction Operations users;
  - issue types;
  - workflows (names only);
  - open issue counts by type and status;
  - automation rules, if readable.
  
  Output goes to `docs/phase1/jira-inventory.md`.
- Flag filters and dashboards that reference issue types proposed for consolidation. This is the saved-filter breakage risk from Atlassian Uplift UAT.
- **Do not change any Jira configuration.** Proposals for keeping, merging or retiring projects are written for humans to action.

**STOP 10.**

---

## 16. Testing, security and quality gates

- **Unit:** every evaluator, metric formula, parser (against fixtures) and enforcement rule.
- **Integration:** use MSW (Mock Service Worker, add it and justify) or Vitest fetch mocks for the Komainu API, Jira and JSM, Slack and Graph. No live network in CI. Add a CI guard that fails if any test makes a real network call (block via a global fetch mock that throws on unmocked hosts).
- **E2E (critical workflows):**
  1. A client Slack question arrives, a JSM request is created, first response is recorded, the item is closed with a write-up, and the metrics update.
  2. An OES settlement fails: the alert fires, a ticket is created, the exchange-contacted tag is added, and the item resolves.
  3. A daily check with an exception creates a ticket.
  4. An attempt to close without a write-up returns 422.
  5. An attempt to acknowledge an alert without a ticket returns 422.
- **Security:**
  - keep existing tests;
  - add `custody-client-is-read-only`, `no-approval-routes`, `prod-has-no-credentials-provider`, `logger-redacts-sensitive-fields`, `allowed-hosts-enforced` and `ai-disabled-by-default`;
  - add CSP review for any new external host;
  - run `npm audit` in CI with the existing `.audit-exceptions.json` process.
- **Data retention:** extend `DataRetentionPolicy` to cover:
  - `CommsMessage` bodies;
  - raw payloads;
  - `TimeLog`.
  
  Retention periods are CONFIRM-RETENTION, with Compliance.
- **Performance:** the Work queue loads in under 1.5 seconds with 5,000 open items (seeded load test). The alert engine run completes in under 10 seconds with 200 rules and parameter sets.
- **Accessibility:** colour is never the only SLA indicator. Use text labels as well.

---

## 17. CONFIRM register (blocking inputs from humans)

Each item gates the listed rules or features. They stay disabled until resolved. Surface this list on `/admin/health` as a checklist.

| ID | What is needed | Blocks |
|---|---|---|
| CONFIRM-SLA-TARGETS | Internal SLA targets per policy (ownership, first response, resolution) | SLA alerts, attainment metrics |
| CONFIRM-RISK-SOURCE | Where GX risk levels can be read (Slack bot posts with samples, or an internal feed) | ALR-RSK-* |
| CONFIRM-RISKCO | Ratified risk tier mapping (Rules 2 and 3 inconsistency; Rules 7–11 Medium) and Control 3.2 wording (one versus two approvals for Medium) | Tier switch in `RiskRuleTier` |
| CONFIRM-RSK-MED-MINS / HIGH-MINS | Clocks for pending medium and high | ALR-RSK-01/02 |
| CONFIRM-API-SCOPE | Whether one read-only API user can see all workspaces | Komainu API aggregation |
| CONFIRM-SETTLEMENT-STATUS | Actual `status` values for settlements, operations and portfolios | ALR-OES-* |
| CONFIRM-OES-WINDOWS | One reference time per exchange (the OKX UTC versus UK-time conflict) | ALR-OES-* |
| CONFIRM-DERIBIT | Deribit OES window and contacts after its move into Coinbase | Deribit windows |
| CONFIRM-AUDIT-EVENTS | Audit-log event names for tap rule, whitelist and risk-parameter changes | ALR-CFG-01 |
| CONFIRM-FAB-TEMPLATES / ACK-MINS / VALUE-DATE-CUTOFF / PROJECT / FEE-ALERT-FORMAT / FEE-THRESHOLDS | FAB email formats, clocks, Jira project and fee alerting | `module.fab`, ALR-FAB-* |
| CONFIRM-MAILBOXES | Mailbox addresses and purposes; Exchange access policy | Graph mail |
| CONFIRM-VENDOR-FORMATS | Redacted vendor notification samples | Vendor parsing |
| CONFIRM-CHAINALYSIS-EXPORT / MTD-EXTRACT / INBOUND-EXTRACT / TATUM | Export templates | CHK-04, 02, 05, 15 imports |
| CONFIRM-NFT-SOURCE | Where pending NFTs are listed | CHK-07 automation |
| CONFIRM-PROJECT-ROLES | Purpose of ITR and RCM for this team | Project config |
| CONFIRM-RISK-SCORE-SCALE | The team's ticket risk score scale | Closure validation |
| CONFIRM-IAI-OWNER | IAI log owner agreement to automated drafts | `iai.drafts.enabled` |
| CONFIRM-CHECK-GAPS | Whether TOP checks 14 and 18–20 exist | Coverage sign-off |
| CONFIRM-KPS-THRESHOLD | Current RiskCo realisation threshold (was $1m; an increase was tabled in August) | ALR-KPS-01 |
| CONFIRM-RETENTION | Retention periods | Retention jobs |
| JSM Slack verification | Section 9.1 checklist completed | `intake.slack.route=jsm_native` |

---

## 18. Pull request plan and definition of done

| PR | Phase | Must include |
|---|---|---|
| 1 | Phase 0: remove approvals, disable AI, scoring, activity and USDC ramp | Deletions, migrations, security tests |
| 2 | Phase 1: worker, SSO, hosting config, egress allowlist | Worker in docker-compose, SSO tests |
| 3 | Phase 2: data model | Migrations, seed of definitions (no real data) |
| 4 | Phase 3: integrations (Komainu API read-only, Jira/JSM, Slack, Graph, imports) | Mocks, health endpoint |
| 5 | Phase 4: client intake | Route flag, rules, tests |
| 6 | Phase 5: ticket enforcement | 422 rules, reports |
| 7 | Phase 6: alerting | Engine, catalogue (all disabled), routing |
| 8a–c | Phase 7: daily coverage by team | Definitions, pulls, evidence, coverage test |
| 9 | Phase 8: metrics | Formulas, reports, per-person guard |
| 10 | Phase 9: UI | Work queue, boards, morning board |
| 11 | Phase 10: Jira inventory | Read-only script output |

**Definition of done (Phase 1 overall):**

- **CI and constraints:** `npm run ci:check` passes, and every hard constraint in Section 2 has a passing enforcing test.
- **Coverage:** the coverage test passes for all 27 tasks, and each shows in the Work UI with evidence capture.
- **Rules and CONFIRM items:** every alert rule exists, is disabled by default, and cannot be enabled while its CONFIRM params are missing. The CONFIRM checklist shows on `/admin/health`.
- **End-to-end demo against mocks:** a client Slack question, an OES failure and a daily check exception each produce a ticket, SLA timers and metrics, with no manual ticket creation.
- **Documentation updated:**
  - `docs/architecture.md`;
  - `docs/integration-guide.md`;
  - `docs/deployment.md`;
  - a new `docs/phase1/runbook.md`, covering how to enable a rule, add a client channel, rotate credentials, and what to do when the worker heartbeat alert fires.

Nothing may be connected to production data until Security, Compliance and IT sign-off is recorded. That sign-off is outside this repo and is performed by humans.
