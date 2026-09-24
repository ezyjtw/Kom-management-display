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
4. **Never guess an external format.** Where this spec says **CONFIRM**, a message format, field value, threshold or endpoint behaviour is not yet known. Build the code path behind configuration or a feature flag, write the parser against a fixture file, and leave a `TODO(CONFIRM-<id>)` comment. Section 20 lists every CONFIRM item. Do not invent sample payloads beyond what this spec gives. Where you need a fixture, create a clearly marked synthetic one under `src/__tests__/fixtures/synthetic/`, and name the file with the CONFIRM id.
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
- Slack channels and shared mailboxes are polled every 5 minutes, 24/7. Never pause polling out of hours.
- Client-visible JSM content (portal requests, public comments) is written by a human. Never auto-post, and never AI-generate it.
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
- **Responsiveness is high and measured.** Slack channels and shared mailboxes are polled every 5 minutes, 24/7. SLA clocks start at the client's message or the triggering event, not when someone notices.
- **Incidents and risks raised from a message get a client-specific JSM ticket.** Any team member can raise one from a Slack message or email. The client can follow its progress in the JSM portal (Section 9.7).
- **Alerts fire for events that need a human response**, including silence: a feed or check that stops producing data is itself an alert.
- **GX changes are tested before they reach production.** Each GX sprint's release notes are pulled automatically. UAT tickets are created for every change that touches Transaction Operations, mapped to the daily tasks it affects (Section 16).
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
| H12 | **Client-visible content is human-written and client-scoped.** A client-facing JSM request or public comment may only contain information about that client. It is written or approved by a named person, never generated automatically or by AI. Compliance-sensitive categories (KYT, sanctions, suspected financial crime) never create client-visible tickets without a recorded Compliance decision, because of tipping-off risk. | Section 9.7 validation; tests `client-ticket-scoped-to-one-client`, `no-auto-public-comments`, `compliance-sensitive-blocks-client-ticket` |

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
- **Polling cadence for messages (24/7, never paused out of hours):** `sync_slack` (all registered Slack channels, root messages and replies) and `sync_mail` (all configured shared mailboxes) run every 5 minutes: `*/5 * * * *`. Change the existing `sync_email` from every 3 minutes to every 5 minutes and rename it `sync_mail`. Merge `sync_slack_channel` (every 2 minutes) into `sync_slack`, so each channel is polled exactly once per 5-minute cycle. Business-hours calendars affect SLA clocks only, never polling. Each cycle reads from the stored cursor (Slack `oldest` ts, Graph delta token), so nothing is missed if a cycle is late. A cycle that fails retries on the next tick; after two consecutive failures, `ALR-HB-SLACK` or `ALR-HB-MAIL` fires.
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
enum WorkItemKind { client_request client_incident client_risk alert daily_check_exception mtd_break oes_settlement fab_instruction kps_case vendor_ticket travel_rule_case screening_case scam_dust_case coin_review staking_exception nft_review report_task incident rca internal_task }
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
  clientTicketKey  String?       // client-visible JSM request (Section 9.7), separate from ticketKey
  clientTicketUrl  String?       // portal URL shared with the client
  sourceMessageRef String?       // Slack permalink or Graph message id the entry was raised from
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
| KMNC | Komainu Changes | read-only: GX sprint "Upgrade in UAT" and "Release in PROD" change tickets, used to time UAT (Section 16) |
| GXD, GXS, AMTK | GX Development, GX Service Management, GX release fix versions | read-only, except creating GXS defect tickets from failed UAT items and adding issue links (Section 16) |

Project keys, issue types, transition ids and custom field ids are read at runtime. Store the mapping in `JiraProjectConfig` (admin-editable). Never hard-code them.

### 8.4 Slack

- Keep the existing bot token and signing-secret verification. **Polling every 5 minutes, 24/7, is the required mechanism** (Section 6.1): `conversations.history` per registered channel from its cursor, then `conversations.replies` for threads with new replies. Respect Slack rate limits with the existing `slack-rate-limiter.ts`, and spread channels across the 5-minute window if the channel count requires it. The Events API (push) may be added later behind flag `slack.events_push` (default `false`) to cut latency. Polling stays on even when push is enabled, as the completeness guarantee.
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
- **Poll every configured shared mailbox every 5 minutes, 24/7,** using Graph delta queries on each mailbox's Inbox (and any configured subfolders). Store the delta token per mailbox so no message is missed across restarts. Group messages into conversations by `conversationId`. Record `SourceHeartbeat` per mailbox (`outlook.<label>`, `expectedEveryMins = 5`).
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

### 9.7 Raise an incident or risk from a message (client-specific JSM ticket)

Any team member can raise an **incident** or **risk** entry directly from:
- an ingested Slack message or thread;
- an email from a shared mailbox;
- an existing WorkItem.

This creates two linked records:
- an **internal entry**, for the team's investigation;
- a **client-specific JSM request** that the client uses to monitor progress in the JSM customer portal.

The internal and client-facing records are deliberately separate, so internal notes are never exposed.

**Entry point.** Show a "Raise incident / risk" action on every message in the WorkItem timeline and in the Slack or email message views. Also add the Slack message shortcut "Raise incident/risk in KOMmand Centre". It only opens a deep link to the form in KOMmand Centre and takes no action in Slack itself.

**Form fields** (server-side validation; all required unless stated):

| Field | Notes |
|---|---|
| Type | `incident` (operational: failed or delayed settlement, withdrawal issue, platform outage affecting the client) or `risk` (suspected compromise, phishing or impersonation, unusual activity, control failure) |
| Client | Pre-filled from the source channel or mailbox mapping (`ClientChannel`). Must resolve to exactly one `Client` with a `jsmOrganizationId`. If unmapped, the form blocks with "map this channel or sender to a client first". |
| Severity | P0–P3 |
| Category | Controlled list (admin-editable), each flagged `complianceSensitive` true or false. Seed flagged true: `kyt_alert`, `sanctions`, `suspected_financial_crime`, `suspicious_activity`. Seed flagged false: `settlement_failure`, `withdrawal_delay`, `platform_issue`, `phishing_impersonation`, `account_compromise_suspected`, `data_issue`, `other`. |
| Client-facing summary | Human-written, plain language, max 1,000 characters. This is the only text the client sees at creation. |
| Internal description | Full detail for the team. Never sent to JSM as public content. |
| Affected references | Optional. Transaction or request ids, stored internally, and **never** copied into the client-facing request automatically. |
| Notify client now | Yes or no (default yes, unless compliance-sensitive) |

**What happens on submit:**

1. **Internal record.**
   - Create a WorkItem of kind `client_incident` or `client_risk`, with `sourceMessageRef` set to the Slack permalink or Graph message id.
   - Create an internal Jira ticket in the configured internal project (CONFIRM-INCIDENT-PROJECT; TOPS by default).
   - Create an IAI draft if `iai.drafts.enabled` is on and the category meets the incident criteria (Section 10.4).
   - Link the originating `client_request` WorkItem, if any.
2. **Client-specific JSM request.** Created only if the category is **not** compliance-sensitive:
   - create a new request in the Transaction Operations service desk, using request type CONFIRM-JSM-INCIDENT-REQUEST-TYPE (for example "Incident / Risk notification");
   - the request **belongs to that client's JSM organisation only** (`organizationId` = `Client.jsmOrganizationId`, plus the client's mapped contacts added as request participants, CONFIRM-CLIENT-CONTACTS);
   - summary = "<Type>: <client-facing summary first 80 chars>"; description = the client-facing summary only;
   - store the key and portal URL in `WorkItem.clientTicketKey` and `clientTicketUrl`;
   - do **not** reuse or convert the original `client_request` ticket, because it may contain internal comments.
3. **Compliance-sensitive categories.**
   - Do **not** create a client-visible request.
   - Create the internal record only, set `metadata.clientTicketBlocked = "compliance_sensitive"`, and alert Compliance (`ALR-CLI-03`).
   - Show a banner: "Client ticket withheld pending Compliance decision (tipping-off risk)".
   - A user with role `admin` can later create the client request only after recording a Compliance decision reference (`complianceDecisionRef`, required, audit-logged).
4. **Tell the client where to follow it** (if "Notify client now" is yes). Post a **human-reviewed** message in the originating Slack thread, or reply to the email conversation, containing the portal link, from a template such as:

   > "We've logged this as <key>. You can follow progress here: <portal link>."

   The message is shown to the operator as an editable draft and sent only when they click Send. It is never auto-posted (H12).

**Keeping the client ticket current:**

- **Client-visible statuses.** Map the internal workflow to a small set shown in the portal: `Received`, `Investigating`, `Update provided`, `Resolved`. Transition the client request only through these, using transition ids looked up at runtime.
- **Public updates.** Written by a person in KOMmand Centre ("Post client update"). They are posted as a JSM **public** comment on the client request, and mirrored as an internal comment on the internal ticket.
  - For P0 and P1, a second team member must approve each public update before it posts (four-eyes, configurable per severity: `clientUpdates.requireSecondApprover`). This is a review of outbound client communication, not a transaction approval.
  - Internal notes go to the internal ticket only. The API must reject any attempt to post internal description text to the client request.
- **Update cadence SLA.** Policy `CLIENT-INCIDENT-UPDATE`: the maximum time between client-visible updates while the item is open, per severity (CONFIRM-CLIENT-UPDATE-CADENCE). Breach raises `ALR-CLI-02`.
- **Resolution.** Closing the internal WorkItem requires the write-up (Section 10.2). It also requires a final client-facing resolution message (human-written) and transitions the client request to `Resolved`. If the client comments on the portal request, the comment is ingested as a timeline message and restarts the first-response clock.

**Client portal access (CONFIRM-JSM-PORTAL).** Client contacts need JSM customer accounts and membership of their organisation. KOMmand Centre does not create customer accounts in Phase 1; IT or Admin Operations does. The form shows "no portal users for this client" when the organisation has no customers, so the operator knows the client cannot yet view it.

**Cross-client safety checks** (enforced server-side before any JSM call):
- the request's organisation must equal the client resolved from the source message;
- request participants must all belong to that organisation;
- the client-facing text is scanned for other clients' names, account numbers and known wallet references from the `Client` table, and blocked if any are found (`client-ticket-scoped-to-one-client`).

**Acceptance tests (9.7):**

- Raising from a Slack message in a mapped client channel creates:
  - one internal WorkItem;
  - one internal Jira ticket;
  - one JSM request in that client's organisation only, with the portal URL stored.
- Raising from a shared-mailbox email does the same, with the client resolved from the sender domain.
- An unmapped channel or sender blocks with 422.
- A compliance-sensitive category creates no JSM request, alerts Compliance, and requires `complianceDecisionRef` to create one later.
- Internal description text never appears in the JSM request body or public comments (`no-auto-public-comments`).
- The client notification message is not sent without an explicit operator Send action.
- A P1 public update without a second approver is rejected.
- Client-visible statuses only move through the four allowed values.
- Client-facing text containing another client's name is blocked.

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
| Incident or risk raised from a message (Section 9.7) | Internal Jira ticket, plus a client-specific JSM request (unless compliance-sensitive) | Two linked tickets; the client sees only the JSM request |
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
| ALR-CLI-01 | Client incident or risk raised | New `client_incident` or `client_risk` WorkItem | Section 9.7 | immediate | P0/P1 critical, else high | internal ticket |
| ALR-CLI-02 | Client update overdue | No client-visible update within the `CLIENT-INCIDENT-UPDATE` cadence while the item is open | SLA engine | CONFIRM-CLIENT-UPDATE-CADENCE | high | internal ticket |
| ALR-CLI-03 | Compliance-sensitive entry raised | Category flagged `complianceSensitive`; client ticket withheld | Section 9.7 | immediate | critical | internal ticket; route to Compliance (CONFIRM-COMPLIANCE-ROUTE) |
| ALR-IAI-01 | IAI draft overdue | 10.4 | job | 24h | high | IAI |
| ALR-VND-01 | Vendor ticket no update | VSR or vendor WorkItem with no vendor update for N business hours (CONFIRM) | Jira + vendor emails | CONFIRM | medium | VSR |
| ALR-HB-SLACK / ALR-HB-MAIL | Message polling stopped | Slack or any shared-mailbox poll has not succeeded for 10 minutes (two missed 5-minute cycles), at any time of day | heartbeats | 10 min, 24/7 | critical | internal |
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
- Source: variances recomputed from Komainu API EOD balances and transactions (Section 18), with the Power BI MTD report used in parallel for verification until the recomputation is proven (18.9).
- Evidence: variance rows reviewed, count, and report data date.
- Exceptions: each break becomes an `mtd_break` WorkItem, diagnosed deterministically and, where the rules allow, with a drafted OTC ticket and workings file for human review (Section 18).
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
| Client incident communication | per client and severity: time from raise to client-visible request, time to first public update, update-cadence attainment, time to resolved; count withheld for Compliance (count only, no detail) |
| Polling health | share of 5-minute Slack and mailbox cycles completed on time, per source |

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
7. **GX sprints** (UAT; Section 16).
8. **Metrics**.
9. **Morning board**.
10. **Admin**: clients and channels, GX impact rules, UAT templates, SLA policies, alert rules, check definitions, team config, Jira project config, imports, feature flags, audit log and health.

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
  - **raise incident / risk** (Section 9.7), available on every message in the timeline;
  - **post client update** on items with a client ticket (human-written; four-eyes for P0 and P1);
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

## 16. PHASE 11 — GX sprint change intake and UAT tickets

Branch: `phase-11-gx-sprint-uat`.

**Goal.** Every GX sprint that changes something Transaction Operations relies on produces UAT tickets automatically:
- before the release reaches production;
- mapped to the daily tasks, alerts and controls it affects;
- with nobody having to read the release notes line by line to decide what to test.

### 16.1 Sources (read-only)

| Source | What it gives | How to read |
|---|---|---|
| Confluence pages titled `[GX-Orchestrate] Sprint <X.YY> Release Notes` in the AMTK space | The structured change list for each sprint | Confluence REST (read), same Atlassian service account. Find pages by title pattern under the release-notes parent page (CONFIRM-GX-RELEASE-PARENT). Re-read whenever the page `version.number` changes. |
| KMNC change tickets named like `GX Sprint <X.YY> Upgrade in UAT` / `Release in UAT` and `GX Sprint <X.YY> Release in PROD (…)` | When the sprint lands in UAT, and the planned PROD date | Jira JQL on project KMNC, summary contains "GX Sprint" (CONFIRM-KMNC-NAMING) |
| Jira issues labelled `Sprint_<X.YY>` (GXS service tickets) and fix versions `<X.YY>.0-alpha.n` / `-rc.n` | Individual fixes, including tickets Transaction Operations raised | JQL of the form `labels = Sprint_6.19`, as linked from the release notes |

Observed cadence (from release notes June to September 2026):
- one sprint roughly every two weeks, for example 6.15 to 6.19;
- one or two intermediate alpha releases mid-sprint;
- a final `rc` release;
- a UAT upgrade followed by a PROD release.

**Cadence of intake.** The user asked for "every few weeks"; make it event-driven plus a safety net:
- a daily job `gx_sprint_intake` at 07:00 UTC finds new or updated release-notes pages;
- the same job runs when a KMNC "Upgrade in UAT" or "Release in UAT" ticket is created or changes status;
- a manual "Run sprint intake" button on `/gx-sprints` (lead or admin);
- config `gx.sprint_intake.cron` (default daily) lets the team change the schedule.

### 16.2 Parsing the release notes

The release notes follow a fixed template, "[GX-Orchestrate] Sprint X.XX Release Notes – Template" in AMTK. Parse by heading and table. Ignore rows whose cells are all empty: the template ships with blank rows. Sections to parse, and how each becomes a change item:

| Release-notes section | Change item type | Creates a UAT ticket when |
|---|---|---|
| 1.1 "Function Released (but disabled or recently enabled in PROD)" (columns: Function, Ops Testing Status, Ops PIC, Comments) | `function_toggle` | Every row. Pre-assign to Ops PIC if the name matches an `Employee`. |
| 1.1 "New screens / actions" (UAT/PROD, Ops UI or Client UI, Screen, Action, Roles, Description) | `ui_change` | Ops UI rows always; Client UI rows as a "client-facing awareness" ticket |
| 1.1 "New API" | `api_change` | Every row. Also create a KOMmand Centre connector regression task (16.4). |
| 1.1 "Changes in Permission" | `permission_change` | Every row, plus an access-review sub-task |
| 1.1 "Stake / Unstake Operation Changes" | `staking_change` | Every row |
| 1.1 "Risk Engine Calc. / Auto Approval Changes" | `risk_engine_change` | Every row, priority P1, and notify Compliance (FYI) |
| 1.1 "Important version changes", "Core file changes" | `technical_change` | Only when "Impacted Functions" matches the operational function keyword list (16.3) |
| 1.5 "Major Highlights" (Workstream, Deliverable, Remarks for Ops, Remarks for Client) | `highlight` | When "Remarks for Ops" is not empty, or the workstream maps to a Transaction Operations task |
| 2.2.1 "This release specific instruction" | `deployment_note` | When the text matches data-impact patterns (16.3), for example renamed columns in `analytics.*` views |
| 1.4 "JIRA Versions & Artifacts" | sprint metadata | Never; gives fix versions and dates |

Store each change item in a new model:

```prisma
model GxSprint {
  id              String   @id @default(cuid())
  sprint          String   @unique        // "6.19"
  releaseNotesUrl String
  pageVersion     Int
  uatLandedAt     DateTime?              // from KMNC ticket
  prodPlannedAt   DateTime?              // from KMNC ticket or release notes
  parentTicketKey String?                // UAT parent ticket
  changes         GxChange[]
}
model GxChange {
  id            String   @id @default(cuid())
  sprintId      String
  section       String                   // parsed heading
  itemType      String                   // function_toggle | ui_change | ...
  summary       String
  detail        Json                     // the parsed row, cell by cell
  gxJiraKeys    Json     @default("[]")  // GXD/GXS/AMTK keys found in the row
  env           String   @default("")    // UAT | PROD | both
  rowHash       String                   // stable hash of normalised row content
  affectedTasks Json     @default("[]")  // task codes from Section 12
  affectedAlerts Json    @default("[]")  // alert codes from Section 11
  affectedControls Json  @default("[]")  // e.g. "3.3", "5.1"
  uatTicketKey  String?
  uatOutcome    String?                  // pass | fail | not_applicable | blocked
  removedAt     DateTime?                // row disappeared from a later page version
  @@unique([sprintId, section, rowHash])
}
```

Parsing rules:
- **Idempotent.** A row with the same `rowHash` is the same change. A changed row gets a new hash and is linked to its predecessor by the Jira keys it contains, or by section and first-cell text. It updates the existing ticket with a "release notes updated (v<n>)" comment rather than opening a new one.
- **A row that disappears** in a later version is marked `removedAt`, and its UAT ticket gets a comment. It is never auto-closed.
- **Extract Jira keys** (`[A-Z]{2,10}-\d+`) from row text and link the UAT ticket to them (the "relates to" link type).
- **Don't follow GitHub links.** They are not needed and are out of scope.
- **Redact** names of release engineers in stored `detail`; they are not needed for UAT.

### 16.3 Impact mapping (config, not code)

Create `GxImpactRule` (admin-editable, versioned, audit-logged):

```prisma
model GxImpactRule {
  id          String  @id @default(cuid())
  matchOn     String  // section | workstream | keyword | jira_project
  pattern     String  // e.g. "Staking", "analytics\\.", "Collateral"
  taskCodes   Json    // e.g. ["CHK-16","CHK-21","CHK-22"]
  alertCodes  Json
  controls    Json
  team        String
  uatTemplate String  // code of a UatTemplate (below)
  priority    String  @default("P2")
}
```

Seed mapping (the team reviews it before enabling; CONFIRM-GX-IMPACT-RULES):

| Match | Affected tasks | Alerts | Controls | Team |
|---|---|---|---|---|
| Workstream "Staking", section "Stake / Unstake" | CHK-16, CHK-17, CHK-21, CHK-22 | — | 5.1, 5.2, 5.3 | 3 (CHK-17: 1) |
| Workstream "Tx Automation (Risk Engine + Tx Auto Approval + Tx Signing)", section "Risk Engine Calc. / Auto Approval" | TASK-RISKVIEW | ALR-RSK-* | 3.2, 3.3 | All |
| Workstream "Collateral Management" | CHK-10 | ALR-OES-* | — | 1 |
| Workstream "FAB Integration" | TASK-FAB | ALR-FAB-* | — | 1 |
| Workstream "Travel Rule" | CHK-09 | ALR-TR-01 | — | 3 |
| Workstream "Komainu API", section "New API" | KOMmand Centre connector (16.4) | ALR-HB-*, ALR-CFG-02 | — | Head of Transaction Operations |
| Workstream "Fee Management" | TASK-FAB (fees), TASK-BILL | ALR-FAB-08 | — | 1 |
| Keyword `analytics\.` or "renamed" or "view" in deployment notes | CHK-02 (MTD Power BI), CHK-05 (inbound dashboard) | — | 4.2 | 2 and 3 |
| Section "Changes in Permission" | Access review | — | — | Head of Transaction Operations |
| GXS ticket in sprint label whose reporter is a Transaction Operations team member | "Verify fix" for the originating WorkItem | — | — | the reporter's team |
| Workstream "Client UI" or "Client On-boarding" | Client-facing awareness (no test by default) | — | — | All |

Worked example: the Sprint 6.19 notes include a deployment note renaming columns in the `analytics.Account` and `analytics.[reports.WalletSummary]` views. The analytics keyword rule would raise a UAT ticket against CHK-02, prompting a check that the MTD Power BI report still works after the rename.

**New wallet technology (H6).** Items that mention the Wallet Tech project or new wallet technology are ingested and tagged `scoped_not_operational`. They create no UAT ticket unless an admin enables rule `gx.uat.include_wallet_tech`, and they never update process documentation as live.

**Released but disabled (H5 and the preference in Section 2).** Items in "Function Released (but disabled…)" are **not live behaviour** until enabled in PROD and passed by Operations. Their UAT tickets carry the label `disabled-in-prod`, and any documentation sub-task stays in draft.

### 16.4 KOMmand Centre's own regression

When a sprint includes a `New API` item or a "Komainu API" highlight, create an internal task: "Check Komainu API spec version and re-run connector contract tests".
- Add contract tests in `src/__tests__/integration/komainu-api-contract.test.ts`. They validate the fields this app depends on (Section 8.1) against the committed spec file.
- Add a script `scripts/check-komainu-api-spec.ts` that compares a newly supplied spec file with the committed one. It reports:
  - added, removed or changed paths and fields;
  - **any newly added write endpoint**, so the allowlist stays deliberate (H2).

### 16.5 Ticket creation

- **Project:** CONFIRM-UAT-PROJECT (default TOPS, issue type "Task", label `uat`). Configurable in `JiraProjectConfig`.
- **Structure per sprint:**
  - one parent ticket "GX Sprint <X.YY> — Transaction Operations UAT";
  - one child (sub-task or linked task) per change item that qualifies (16.2);
  - further child tasks for documentation follow-ups (below).
- **Child ticket content:**
  - summary `[UAT <X.YY>] <item type>: <summary>`;
  - a description with:
    - the parsed row (as a table);
    - a link to the release-notes page and section;
    - linked GX Jira keys;
    - affected tasks, alerts and controls;
    - the UAT test outline from the mapped `UatTemplate`;
    - an environment line: "Test in GX UAT only".
  - labels `uat`, `gx-sprint-6-19` (sprint with dashes), and the item type.
- **Test outlines are human-authored.** Create a `UatTemplate` model (`code`, `title`, `steps` markdown, `expectedResults`, `evidenceRequired`). Seed it with **empty templates named per mapping row**, for the team to write. Do not write test steps for GX functions yourself, and do not use AI. Until a template has content, the ticket says "Test outline not yet written: owner to define".
- **Due date:** `prodPlannedAt − CONFIRM-UAT-LEAD-DAYS` business days. If there is no PROD date yet, use `uatLandedAt + 5` business days (configurable).
- **Assignment:** Ops PIC from the release notes if it matches an Employee; otherwise the mapped team's lead (Section 12, `TeamConfig`).
- **Outcome capture:** closing a UAT child requires the Section 10.2 write-up, plus:
  - `uatOutcome` (`pass | fail | not_applicable | blocked`);
  - evidence (screenshot or reference);
  - a **fail** needs a linked GXS defect ticket. KOMmand Centre may create it with a pre-filled description, and the tester confirms before it is sent.
- **Documentation follow-up.** For each affected task code, create one "Review TOP procedure for <task>" task, linked to the task's Confluence page. It is due after PROD release. It must not describe the change as live until the UAT item passes and the release is in PROD.
- **Testing happens in GX UAT, by people.** KOMmand Centre creates and tracks tickets only. It never executes tests against GX, and never performs approvals in any environment (H1).

### 16.6 Alerts (add to the Section 11.2 catalogue)

| Code | Name | Trigger | Clock | Severity | Ticket |
|---|---|---|---|---|---|
| ALR-UAT-01 | New GX sprint changes need UAT | New or updated release-notes page produced new qualifying change items | immediate | medium | UAT parent |
| ALR-UAT-02 | UAT not complete before PROD | Any child UAT ticket for the sprint without an outcome when `prodPlannedAt − 2 business days` is reached | 2 business days before PROD | high | UAT parent |
| ALR-UAT-03 | UAT failed | Child closed with `fail` | immediate | high | linked GXS defect |
| ALR-UAT-04 | Release notes changed after UAT sign-off | Page version changes after all children have outcomes, adding or changing rows | immediate | high | UAT parent |
| ALR-UAT-05 | Risk-engine or permission change in sprint | Any `risk_engine_change` or `permission_change` item | immediate | high | child ticket; notify Compliance or IT per mapping |
| ALR-HB-GXNOTES | Release notes not found | No release-notes page for a sprint that has a KMNC UAT ticket | 1 day | medium | internal |

### 16.7 UI

A `/gx-sprints` page lists sprints, showing:
- UAT landed and PROD planned dates;
- change items by type;
- mapping to tasks;
- UAT ticket status and outcomes;
- a gate indicator (green once all outcomes are recorded and there are no open fails).

Each team board (Section 14) shows "UAT due this sprint" for its tasks.

### 16.8 Metrics (add to Section 13.2)

Per sprint:
- change items affecting Transaction Operations;
- UAT tickets created;
- completed before PROD (%);
- fails and defects raised;
- items added after sign-off.

These are team-level only.

### 16.9 Acceptance tests

- **Template parse:** a synthetic release-notes page built from the template headings (fixture `synthetic/CONFIRM-GX-RELEASE-SAMPLE.md`) parses into the expected change items; blank template rows are ignored.
- **Page updates:** re-parsing an unchanged page creates no new items or tickets. An edited row updates its ticket with a comment. A removed row sets `removedAt` without closing the ticket.
- **Mapping:**
  - a staking row maps to CHK-16/21/22 and Team 3;
  - an `analytics.` rename in deployment notes maps to CHK-02;
  - a risk-engine row creates a P1 ticket and fires ALR-UAT-05.
- **Wallet technology:** wallet-tech items create no UAT ticket by default.
- **PROD gate:** ALR-UAT-02 fires at the right business-day offset from a KMNC PROD ticket date.
- **Failed items:** closing a child as `fail` without a linked GXS ticket is rejected with 422.
- **No GX execution:** a static check confirms no code in `src/modules/gx-sprints/` calls anything other than Confluence GET, Jira search and GET, and Jira create or update for issues, comments and links.

**STOP 11.**

---

## 17. PHASE 12 — Security architecture (evaluation readiness)

Branch: `phase-12-security-hardening`. Some items here are prerequisites for earlier phases (see 17.9); build them in the order given there, not necessarily after Phase 11.

This section maps KOMmand Centre onto Komainu's own Platform Security Principles so the design can be assessed against the standard the platform is already held to, rather than a generic checklist. Sources: [Platform Security Principles](https://komainu.atlassian.net/wiki/spaces/EB/pages/1815347239/Platform+Security+Principles), [Defence in Depth Platform Architecture](https://komainu.atlassian.net/wiki/spaces/EB/pages/1823309829/Defence+in+Depth+Platform+Architecture), [Threat Modelling and Security Design Reviews](https://komainu.atlassian.net/wiki/spaces/EB/pages/1822720004/Threat+Modelling+and+Security+Design+Reviews), [GX Security Design](https://komainu.atlassian.net/wiki/spaces/AMTK/pages/8504022/Security+Design), [Workload Identity, tmpfs Secret Injection and JWS Inter-Service Auth](https://komainu.atlassian.net/wiki/spaces/AMTK/pages/1723334657/Security+Enhancement+Workload+Identity+tmpfs+Secret+Injection+and+JWS+Inter-Service+Auth), [Developer Environment Security](https://komainu.atlassian.net/wiki/spaces/EB/pages/1816068157/Developer+Environment+Security+IDEs+Extensions+MCP+and+AI+Tooling), [Access management](https://komainu.atlassian.net/wiki/spaces/PS/pages/311590915/Access+management), [Secret Leak Actions](https://komainu.atlassian.net/wiki/spaces/PS/pages/928776298/Secret+Leak+Actions).

Several of those pages are marked DRAFT. Treat them as the current direction of travel and confirm the binding requirements with Platform Security during the design review (17.8).

### 17.1 Principle mapping (what the reviewer will ask)

| Principle | What it means here | Phase 1 implementation |
|---|---|---|
| D1 Zero trust, explicit trust boundaries, least privilege | Every call authenticated and authorised; deny by default; no standing privilege | Entra SSO (6.2); per-route `requireAuthorization`; documented trust boundaries (17.2); read-only Komainu API user; Entra PIM for the admin role (17.3) |
| D2 Defence in depth | No single control failure is a breach | Network isolation, authn/authz, input validation and egress allowlist as independent layers (17.2, 17.4) |
| D3 Data and tenant isolation | Client data separated; each service owns its store | Client scoping enforced server-side (17.5); KOMmand Centre owns its database and never writes another service's store |
| D4 Third-party trust explicit | Dependencies reviewed, pinned by SHA, SBOM, provenance | 17.6 |
| D5 Security by default | Minimal surface, fail securely, no internal detail in errors, observability by design | 17.4, 17.7 |
| DL1 Protected mainline | Peer review, two-person review for production | Branch protection and CODEOWNERS (17.6) |
| DL2 Pipeline scanning | SAST, SCA, IaC, image scanning, secret detection | 17.6 |
| DL3 No secrets in source or logs | Managed identity over secrets; no secrets in env, files or logs | 17.3 |
| DL6 Signed artefacts | Commit signing, signed images, verification at deploy | 17.6 |
| O1 Just-in-time privileged access | No standing admin; two-person review where a service account is unavoidable | 17.3 |
| O2, O3 Vulnerability and issue SLAs | Findings owned and remediated to SLA | 17.6 |
| O5 Continuous assurance | Pen test and review, tracked to closure | 17.8 |

### 17.2 Layered architecture for KOMmand Centre

The platform's defence-in-depth model runs from client authentication through perimeter, edge, core application, vault access and egress. KOMmand Centre is an **internal, staff-only** application with no client-facing surface, so its layers are:

| Layer | Control | Notes |
|---|---|---|
| 1. Access path | No public internet exposure. Reachable only through ZScaler Private Access (ZPA), as an application segment named per the existing convention, or equivalent private access agreed with IT | This is the single biggest posture difference from the current codebase, which assumes public hosting |
| 2. Identity | Entra ID SSO, phishing-resistant MFA inherited from tenant Conditional Access; no local passwords in production; roles from Entra groups only | 6.2 |
| 3. Edge | Azure Application Gateway or Front Door with WAF (OWASP Core Rule Set), rate limiting, and the security headers below | 17.4 |
| 4. Application | Server-side authorisation on every route; input validation; output encoding; CSRF protection; session controls | 17.4, 17.5 |
| 5. Data | Azure PostgreSQL, private endpoint only, TLS enforced, encryption at rest with Microsoft-managed keys as a minimum, automated backups | 17.5 |
| 6. Egress | Outbound allowlist to the six permitted hosts (6.4), enforced in code and at the network layer | 6.4 |
| 7. Monitoring | Application and audit logs shipped to the tenant's log platform for SecOps correlation | 17.7 |

There is **no signing, vault or custody domain** in this application, and there must never be one. That is the architectural reason the approvals module is deleted rather than restricted (H1). State this explicitly in the design review: KOMmand Centre sits entirely outside the custody trust boundary and holds no key material.

### 17.3 Identity, secrets and privileged access

- **Workload identity, not secrets.** Where KOMmand Centre talks to Azure services (database, Key Vault, storage), use a **user-assigned managed identity per workload** (web and worker separately), federated to its Kubernetes ServiceAccount or App Service identity. No connection strings, no account keys.
- **Residual third-party secrets** (Atlassian API token, Slack bot token, Komainu API user secret) have no Entra equivalent. Hold them in Azure Key Vault and mount them as **files on an in-memory tmpfs volume**, read at startup. Do not create Kubernetes `Secret` objects and do not inject them as environment variables. This means `src/lib/env.ts` needs a small loader that reads a secrets directory (`SECRETS_DIR`, default `/mnt/secrets`), where each file name is the config key, falling back to environment variables in development only.
- **Rotation.** Every credential has a named owner and a rotation cadence recorded in `docs/phase1/credentials.md`: what it is, where it lives, who owns it, how to rotate, and the blast radius if leaked. Tokens are rotated at least annually and immediately on suspected leak, following the Secret Leak Actions procedure (revoke first, then remove, then remediate).
- **Least privilege on external accounts.** The Atlassian service account gets project-scoped permissions for the projects in 8.3 only, with no admin rights. The Slack app requests only the scopes it uses, listed in `docs/phase1/slack-scopes.md`. The Graph app registration is restricted to named mailboxes by an Exchange application access policy. The Komainu API user has read-only rights (H2), configured Komainu-side.
- **No standing admin.** The KOMmand Centre `admin` role, which can change alert rules, SLA policies and impact mappings, is assigned through an **Entra PIM-eligible group** with approval and time-bound activation, mirroring O1. Day-to-day users hold `employee` or `lead`.
- **Break-glass.** If Entra SSO is unavailable, recovery follows the existing application-admin pattern held by IT and Security, not a local password. Document that any break-glass use raises `ALR-SEC-04` and is reviewed.
- **Access reviews.** KOMmand Centre is registered in the IT Services inventory with a service owner, an access review owner, a business criticality, and a note that it holds personal data (staff names and client contact details). Access reviews follow the existing periodic cadence, with evidence stored where the access management template says.

### 17.4 Application hardening

Apply the controls the platform already requires of GX, adapted to Next.js:

- **Security headers** at the edge and in `next.config.js`: `Strict-Transport-Security` (one year, includeSubDomains), `Content-Security-Policy` (no `unsafe-inline` or `unsafe-eval`; use nonces for scripts), `X-Frame-Options: deny`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Permitted-Cross-Domain-Policies: none`; strip `X-Powered-By`. Test: `security-headers-present`.
- **Sessions.** Cookies `httpOnly`, `secure`, `sameSite: lax`, host-scoped. No token in localStorage or sessionStorage. Session lifetime 12 hours, idle timeout 1 hour, revocation preserved.
- **CSRF.** All state-changing routes require a CSRF token; the check runs in middleware, not per route, so a new route cannot forget it. Test: `csrf-required-on-mutations`.
- **Input validation.** Every API route validates its body and query with a Zod schema (the codebase already uses Zod); reject unknown fields, and cap string lengths, array sizes and JSON depth. Test: `every-api-route-has-a-schema` walks the route files and fails on any mutation route with no schema.
- **Output encoding.** No `dangerouslySetInnerHTML` anywhere. Test asserts it does not appear in `src/`.
- **Fail securely.** A standard error model returns a code and a safe message; stack traces, SQL and upstream payloads never reach the client. Unhandled errors return 500 with a correlation id only.
- **Rate limiting.** Per-user and per-IP limits on authentication, search and export routes. Exports are already audit-logged; add a daily volume cap per user with `ALR-SEC-03` on breach.
- **Untrusted content is data, never instruction.** Slack messages, emails, Jira and Confluence text, GX release notes and vendor emails are parsed as data. Nothing in them is ever executed, evaluated, used to build a query, or treated as an instruction. Because the AI features are off (H3) there is no prompt path in Phase 1; if AI is ever enabled, this is the indirect prompt-injection risk that Platform Security has already documented for agentic tooling, and it needs its own review before the flag is turned on.
- **File handling.** Imports (Chainalysis, MTD, Tatum) accept only allowlisted extensions and MIME types, cap file size, parse in a worker with a timeout, and never execute macros. `.xlsm` is rejected outright.

### 17.5 Data protection

- **Classification.** The application holds confidential data: client names, wallet addresses, transaction ids and amounts, client contact details, and staff identities. Record this in the service inventory entry and in `docs/phase1/data-inventory.md`, listing each dataset, its source, its retention and its owner (D5 observability, dataset cataloguing).
- **Isolation.** Client scoping is enforced server-side in a single place (a query helper every client-scoped read and write goes through), not per route. The cross-client checks in 9.7 are part of this. Test: `client-scoping-enforced` proves a user cannot fetch another client's items by id.
- **Encryption.** TLS 1.2 or above everywhere, including to the database. At rest, Azure platform encryption as a minimum; ask Security whether customer-managed keys are required at this classification.
- **Minimisation.** Store the fields the features need. Do not mirror full GX transaction history; keep identifiers and the fields each check uses. Message bodies are needed for the inbox, so they carry the shortest retention that still serves the audit need.
- **Redaction in logs (H8).** Wallet addresses, transaction hashes, client names, account numbers, message bodies, tokens, user IP addresses and geolocation are redacted by the logger. Test: `logger-redacts-sensitive-fields` feeds known patterns through and asserts none survives.
- **Backups and restore.** Automated database backups with point-in-time restore; a restore is tested once before go-live and the result recorded.
- **Deletion.** Retention jobs delete on schedule (CONFIRM-RETENTION). A staff leaver's personal data follows the tenant's HR process; document how their WorkItems and notes are preserved for audit while their identity is handled per policy.

### 17.6 Supply chain and pipeline

- **Dependency pinning.** Commit `package-lock.json`; pin GitHub Actions by commit SHA, not by floating tag (D4). Pin the Docker base image by digest.
- **Scanning in CI**, each failing the build on a finding above the agreed threshold: SAST (CodeQL or SonarQube per the platform's existing tooling), SCA for dependencies, secret detection (`detect-secrets`, with the baseline file the platform already uses), container image scanning (Wiz), and IaC scanning for any deployment manifests. Local Wiz scanning applies to developer machines, as it does for the rest of engineering.
- **SBOM** generated per build and retained with the artefact.
- **Signing.** Signed commits, signed images, and signature verification at deployment, targeting SLSA Level 1 initially.
- **Branch protection.** Protected `main`, required review, CODEOWNERS on `src/lib/integrations/`, `src/modules/auth/`, `src/worker/` and anything under `deploy/`. Two-person review for production changes (DL1).
- **Findings** are logged with an owner and remediated within the platform vulnerability SLAs; exceptions are recorded and accepted only by an authorised role.
- **Provenance of this build.** Because much of this codebase was AI-assisted, state that plainly in the review pack. The engineering rule is that AI output is treated as your own and reviewed as critically as a colleague's pull request; the Phase 0 audit in 17.9 is how that is evidenced here.

### 17.7 Logging, monitoring and detection

- **Structured audit logging** already exists (`AuditLog`); extend it so every one of these records actor, action, target, result and correlation id: sign-in and sign-out, permission denied, role change, alert rule or SLA policy change, client or channel mapping change, export, client-visible content posted, compliance-sensitive withholding and override, Komainu API credential use, and break-glass access.
- **Immutability.** Audit rows are append-only: no update or delete path in code, and the database role the app uses has no `DELETE` on that table. Retention is at least as long as the regulatory record-keeping requirement (CONFIRM-AUDIT-RETENTION with Compliance).
- **Ship logs to the tenant platform** (Sentinel or the agreed SIEM) so SecOps can correlate KOMmand Centre events with Entra sign-ins and platform logs, per the existing log-correlation work. Provide the log schema and a source-onboarding note in `docs/phase1/logging.md`.
- **Detection use cases to propose to SecOps** (they own the rules, not this repo):
  - repeated authorisation failures for one user or across users;
  - export volume spike, or export by a user who does not normally export;
  - alert rule or SLA policy changed outside change hours;
  - client mapping changed then immediately used to raise a client ticket;
  - Komainu API credential used from an unexpected workload;
  - worker heartbeat lost while alerts remain unacknowledged.
- **Internal security alerts** (add to the Section 11.2 catalogue):

| Code | Name | Trigger | Severity |
|---|---|---|---|
| ALR-SEC-01 | Repeated authorisation failures | More than N denied requests for one user within a window | high |
| ALR-SEC-02 | Privileged configuration change | Alert rule, SLA policy, impact rule, client mapping or role changed | medium (informational, ticketed) |
| ALR-SEC-03 | Export threshold exceeded | Export volume above the daily cap | high |
| ALR-SEC-04 | Break-glass or non-SSO access used | Any production login not through Entra | critical |
| ALR-SEC-05 | Integration credential failure | Repeated 401 or 403 from a connector, which may indicate revocation or misuse | high |

### 17.8 Threat model and review route

Produce a written threat model in `docs/phase1/threat-model.md` before the security review, using STRIDE against each trust boundary, plus the Komainu-specific abuse cases the hybrid method calls for. Boundaries to enumerate: browser to app, app to database, app to Komainu API, app to Atlassian, app to Slack, app to Graph, app to client-visible JSM content, and worker to all of the above.

Abuse cases that must appear, with the mitigation each maps to:

| Abuse case | Mitigation |
|---|---|
| A compromised dashboard session is used to move client funds | No custody write path exists at all (H1, H2); the Komainu API user cannot write |
| An operator leaks one client's data to another through a client ticket | Server-side client scoping and cross-client text checks (9.7, 17.5) |
| Tipping off a client under investigation | Compliance-sensitive categories never auto-create client-visible tickets (H12) |
| An attacker suppresses an alert to hide an incident | Alerts cannot be cleared without a ticket; audit is append-only; SecOps receives the log stream |
| A malicious Slack message or vendor email manipulates the system | All external content parsed as data; no execution path; AI off (17.4) |
| The Atlassian token is stolen | Project-scoped permissions, tmpfs storage, rotation, `ALR-SEC-05`, revoke-first procedure |
| An insider edits an alert rule to stop a control firing | Rule changes need PIM-activated admin, are audit-logged and raise `ALR-SEC-02` |
| Stale data causes a missed break | Heartbeats and freshness indicators on every view (11.2, 13.3) |

**Review route, in order:** threat model and design review with Platform Security → engineering security review of authentication, authorisation and integration code → pipeline scanning clean → penetration test scoped to the application (the platform's continuous assurance principle) → findings remediated and retested → sign-off recorded before any production credential is issued.

### 17.9 Build order note

Three items are prerequisites rather than a final phase, and must land with the phases they protect:
- **Entra SSO and no local passwords** (6.2) before any real data is loaded.
- **Secrets in Key Vault with tmpfs mounting** (17.3) before the first live credential is issued, which is Phase 3.
- **Private access, WAF and egress allowlist** (17.2, 6.4) before the first deployment to a shared environment.

The rest of this section can be built alongside Phases 4 to 11, but all of it must be complete before the security review.

### 17.10 Acceptance tests

- `security-headers-present`, `csrf-required-on-mutations`, `every-api-route-has-a-schema`, `no-dangerously-set-inner-html`, `client-scoping-enforced`, `logger-redacts-sensitive-fields`, `audit-log-is-append-only`, `prod-has-no-credentials-provider`, `allowed-hosts-enforced`, `no-secrets-in-env-in-production` (asserts the secret loader is used and that secret-bearing environment variables are absent when `SECRETS_DIR` is set).
- A documentation check that `threat-model.md`, `data-inventory.md`, `credentials.md`, `logging.md` and `slack-scopes.md` exist and are not placeholders.

**STOP 12.**

---

## 18. PHASE 13 — Deterministic MTD break diagnosis and OTC ticket drafting

Branch: `phase-13-otc-automation`. This phase automates CHK-02, the daily MTD variance check, and the OTC tickets that follow from it.

**The goal and the boundary.** Given the Komainu API's balance and transaction data, the dashboard recomputes the MTD variances itself, diagnoses each break against the documented break types, reconciles the exact transactions responsible, and drafts the OTC ticket with its workings. **Every step is deterministic: rules, arithmetic and table lookups only. There is no AI, no inference and no fuzzy matching anywhere in this pipeline** (H3). A person reviews and submits every ticket.

### 18.1 Why this can be deterministic

The existing `late-snapshot-otcs` skill already expresses the diagnosis as exact arithmetic: a sign table per transaction type, a reconciliation that must match to the last decimal place, and a bidirectional sanity check on the variance shape. What it uses a model for is orchestration, file wrangling and judgement, not the maths. Moving it into code replaces the model with:

| Skill element | Deterministic replacement |
|---|---|
| Finding and classifying input files | Direct Komainu API reads; no file handling at all |
| Interpreting the trigger message | A wallet and date chosen in the UI, or the whole day's scan |
| Sign table lookup | `SignRule` table (18.4), exact match on type, direction and sub-category |
| Reconciling late transactions | A fixed algorithm with an exact-match requirement (18.5) |
| Variance shape sanity check | The same checks as blocking assertions |
| Deciding the break type | A decision table over computed signals (18.4) |
| Filling the template | `exceljs` writing the template at full precision (18.6) |
| Drafting the ticket | String templates with computed values (18.7) |
| Judgement, exceptions, submission | The human reviewer (18.8) |

Anything the rules cannot resolve is **not guessed**. It is shown to the reviewer as undiagnosed, with the evidence attached.

### 18.2 Data sourcing: replacing the exports

The skill reads three files: a Power BI MTD export, a Discrepancies Recon CSV and a GX Transaction Summary CSV. With the Komainu API connected, all three come from primary data:

| Skill input | Replacement | Endpoint |
|---|---|---|
| Discrepancies Recon (EOD balances per wallet per day) | `EodBalanceSnapshot` table, filled daily | `GET /v1/custody/wallets/eodbalances`, `/v1/custody/wallets/{id}/eodbalances` |
| GX Transaction Summary | `GxTransaction` table | `GET /v1/custody/transactions` |
| Power BI MTD daily variances | Computed by the dashboard (18.3) | derived |

**The 30-day limit matters.** The end-of-day balance endpoint returns at most the last 30 days, so the daily pull is the only way to build history. Snapshots are immutable once written, **except** for a late catch-up: if a re-read of a past date returns different figures, write a new row version and keep the old one, because that change is itself evidence of a late snapshot.

```prisma
model EodBalanceSnapshot {
  id           String   @id @default(cuid())
  walletId     String
  date         DateTime @db.Date      // the EOD date
  version      Int      @default(1)   // increments if GX restates the day
  total        Decimal  @db.Decimal(38,18)
  available    Decimal  @db.Decimal(38,18)
  locked       Decimal  @db.Decimal(38,18)
  staked       Decimal  @db.Decimal(38,18)
  pending      Decimal  @db.Decimal(38,18)
  quarantined  Decimal? @db.Decimal(38,18)
  delegated    Decimal? @db.Decimal(38,18)
  fetchedAt    DateTime @default(now())
  @@unique([walletId, date, version])
}
model GxTransaction {
  id                String   @id           // GX transaction id
  walletId          String
  createdAtUtc      DateTime
  asset             String
  txnType           String
  direction         String                 // In | Out
  amount            Decimal  @db.Decimal(38,18)
  stakeRewards      Decimal? @db.Decimal(38,18)
  walletCategory    String?
  walletSubCategory String?
  status            String?
  firstSeenAt       DateTime @default(now())
  @@index([walletId, createdAtUtc])
}
```

**Precision is non-negotiable.** Use `Decimal` columns and `decimal.js` (add it) for every balance and amount. **Never** use JavaScript numbers in reconciliation arithmetic: floating point is exactly how a figure ends up truncated, and the break catalogue names truncated figures as a recurring misdiagnosis. Test: `no-float-arithmetic-in-mtd` fails on any arithmetic operator applied to a balance or amount outside `Decimal`.

### 18.3 Recomputing the variances

Compute per wallet per date from the two tables above. The definitions come from the documented MTD variance semantics and must be verified against Power BI before the output is trusted (18.9).

- **Balance Variation** = `total − (available + locked + staked + pending + quarantined + delegated)`; an internal-consistency check.
- **Transaction Variation** = cumulative rolling net transactions against either **Total** or **Available**, by asset: Available for ATOM, ETH, INJ_INJ and NEAR, Total for everything else. Hold this in an admin-editable `AssetVarianceReference` table seeded with those four, not in code: new assets are onboarded regularly, and a wrong reference silently misdiagnoses every break on that asset.
- **Staked Variation** = cumulative staking actions against the EOD staked balance.
- **Daily delta** for each = today's cumulative minus yesterday's.

Store **both** the cumulative figure and the daily delta in separately named columns (`txnVariationCumulative`, `txnVariationDaily`). One column name meaning a cumulative figure in one export and a daily figure in another is the most error-prone step in the manual process; naming them apart removes the ambiguity permanently.

Persist as `MtdVariance` (wallet, date, three cumulative figures, three daily deltas, reference column used, computation version).

### 18.4 Rule tables (the deterministic core)

All admin-editable, versioned and audit-logged; each change raises `ALR-SEC-02`. Seeded from the documented break types and reviewed by the team before anything is enabled (CONFIRM-OTC-RULE-REVIEW).

**`SignRule`** — the balance signature per transaction type, from the OTC break types page and the skill's sign table:

| txnType | direction | subCategory | Δtotal | Δavailable | Δlocked | Δstaked |
|---|---|---|---|---|---|---|
| REWARD (SOL) | In | — | +amt | | | +amt |
| REWARD_MEV (SOL) | In | — | +amt | | +amt | |
| REWARD_CL (ETH) | In | — | | +amt | −amt | |
| REWARD_EL (ETH) | In | — | +amt | +amt | | |
| Transfer IN | In | non-staking | +amt | +amt | | |
| Transfer IN | In | staking | +amt | | +amt | |
| Transfer OUT | Out | — | −amt | −amt | | |
| DELEGATE | Out | — | 0 | −amt | | +amt |
| UNSTAKE / WITHDRAW | In | — | 0 | +amt | | −amt |
| FEES | Out | — | −fee | −fee | | |

Types the documentation marks as varying or needing confirmation (REWARD_PAYOUT, REWARD_ST, REWARD_RB, TRANSFER_TO_CHILD, RAW, TYPED_MESSAGE, CONTRACT_CALL) are seeded with **no signature** and `requiresHuman = true`. A break containing one is never auto-diagnosed. **Never extrapolate a signature for an unknown type**; that rule holds in code as it does in the skill.

**`BreakTypeRule`** — the decision table from the break amendment catalogue:

| # | Conditions (all must hold) | Break type | OTC action | Auto-draft? |
|---|---|---|---|---|
| 1 | `txnVariationDaily < 0`; every reconciled transaction has a known signature; the transactions exist in GX on the break date with timestamps after the snapshot; reconciliation exact | Late GX snapshot | EOD Balance Request | Yes |
| 2 | Rule 1's shape, but the snapshot repeats the prior day's figures and misses in-day transactions | Stale carry-forward | EOD Balance Request | Yes, flagged |
| 3 | `txnVariationDaily > 0`; balance moved with no matching GX transaction | Missing transaction | Upload Internal Transaction | **No** |
| 4 | `balanceVariationDaily ≠ 0` | Sub-balances do not sum to total | Investigate | **No** |
| 5 | Two GX transactions for the same economic event (same amount, type, near-identical timestamp) | Possible duplicate | Void Transaction Request | **No** |
| 6 | Non-zero balance on surrounding days, zero or impossible on the break date, no transactions | Phantom dropped snapshot | EOD Balance Request | Yes, flagged |
| 7 | Pending non-zero across the day boundary, transaction lifecycle spans two days | Overnight pending | EOD Balance Request | **No** |
| 8 | Anything else, any `requiresHuman` type present, or reconciliation not exact | Undiagnosed | — | **No** |

Only rules 1, 2 and 6 auto-draft, and all three are EOD Balance Requests: the highest-volume type with the cleanest evidence. Rule 3 must not auto-draft, because the catalogue warns that raising an internal transaction before checking whether the provider will backfill it creates duplicates.

**`AssetVarianceReference`** (asset → Total or Available) and **`SnapshotWindow`** (EOD snapshot time, 00:00 UTC by default, used to decide whether a transaction is after the snapshot).

### 18.5 The reconciliation algorithm

For a candidate (wallet, break date) matching rule 1 or 2:

1. **Target** = `Σ(signed GX transaction amounts for the break date) − (net transactions the snapshot captured for that date)`, both at full precision from the API. This is the skill's preferred target and depends on no Power BI figure.
2. Take the wallet's transactions for the break date, sorted by `createdAtUtc` **descending**.
3. Accumulate signed amounts from the latest backwards.
4. **Stop when the accumulated sum equals the target exactly** — `Decimal` equality, not a tolerance.
5. If the accumulation overshoots without an exact hit, or would include a transaction timestamped before the snapshot window, **stop and mark undiagnosed**. No approximate fallback. Report the shortfall and the candidate set as evidence.
6. Record the reconciled set: per transaction, id, timestamp, type, direction, amount and sub-category.

**Partial runs are handled by construction.** Because the target is computed from what the snapshot actually captured, a reward run where the snapshot caught some transactions reconciles to the remainder, not the day's total. Applying the full day's total to a partial run is one of the catalogue's listed misdiagnoses.

**The masked case.** Where a break date shows a daily transaction variation of zero because both the snapshot and the rolling aggregation missed the same transactions, the break surfaces the next day. The scan therefore examines a **two-day window** per wallet and attributes the break to the date the transactions belong to, flagging it `maskedBreak = true` so the reviewer sees why the dates differ.

### 18.6 Corrections and workings

- **Corrections** are computed per transaction from `SignRule` and summed per balance column; mixed types stack. Never derive the correction from the variance shape — the shape is only a check.
- **Blocking sanity checks**, bidirectional. Any failure marks the break undiagnosed instead of drafting:
  - computed Δ staked non-zero but observed staked variation zero, or the reverse;
  - observed balance variation non-zero on a late-snapshot diagnosis;
  - `|txnVariationDaily|` not equal to the sum of late transaction amounts affecting the asset's reference column;
  - applying the correction does not take the break date's transaction variation to **exactly** zero.
- **Workings file**, generated with `exceljs` from the canonical template committed at `docs/phase1/templates/EOD_Balance_Request_template.xlsx`:
  - full precision throughout; write `Decimal` values with a 15-decimal display format, never rounded or re-typed;
  - balance figures come from the EOD snapshot for that wallet and date;
  - **blank, not zero**, for balance columns with no adjustment, because a literal zero makes the direction-of-change formulas read "Lower" instead of "-";
  - one row per wallet and break date; wallets sharing a break type and date go on consecutive rows;
  - a workings table listing **every late transaction individually** with its timestamp, grouped per wallet, with a per-wallet subtotal checked against that wallet's delta cell and a grand total checked against the sum of the delta column, using independent reference paths on each side;
  - wallet category, sub-category and status from the wallet's most recent transaction, flagged if they disagree across the day;
  - **one workings file per ticket**;
  - recalculate after writing and assert zero formula errors before the file is offered for review.

### 18.7 Ticket drafting

Draft, never submit.

- **Project** OTC, issue type `OT - EOD Balance Request`.
- **Title:** `OT - EOD Balance Request_<DD-MM-YYYY today> - <break type> - <wallet(s)> | <break date(s)> | <variance at full precision> | <brief> | <initials>/Claude`. The brief is generated by counting types in the reconciled set, for example "2x REWARD_CL".
- **Body:** a fixed template with computed values substituted — wallet, break date, count and types of late transactions, their timestamps, which balance column the snapshot missed, the self-resolution date, and the signed delta per balance column. No free text is generated.
- **Custom fields:** Wallet Type, Variance Type and MTD, using the team's existing field mapping. Variance Type comes from the diagnosed break type through a `BreakTypeRule` mapping; Wallet Type is derived from the wallet's category, with reviewer override (CONFIRM-OTC-FIELD-MAPPING).
- **Duplicate check before drafting, mandatory.** Search OTC for tickets covering the same wallet and break date **whatever their creation date**, not just today's, since a re-run or a backdated review would otherwise duplicate. Any match blocks the draft and shows the existing ticket. Two live tickets for the same wallet and break date can cause a correction to be applied twice to a client balance.
- **Supersession.** Withdrawing a drafted or raised ticket requires, as one action, that the replacement links to the original, comments on it instructing that it not be actioned, and transitions it out of the open queue.
- **Attachment is manual.** The Atlassian API cannot attach files, so the ticket is unactionable until a person attaches the workings. The draft screen says so, the ticket is tracked as `awaiting_attachment`, and `ALR-OTC-02` fires after 30 minutes.

### 18.8 The review step

Nothing reaches Jira without a person. The daily MTD screen shows, for the selected date:

1. **Auto-diagnosed breaks:** break type, reconciled transactions, computed corrections, sanity-check results, the workings file and the drafted ticket. The reviewer opens the evidence, then creates or rejects with a reason.
2. **Undiagnosed breaks:** variance figures, the day's transactions, and which rule fell over and why ("reconciliation overshot by X", "transaction type CONTRACT_CALL has no signature"). No draft is offered.
3. **No-auto-draft rules:** the suggested OTC action with the catalogue's diagnosis steps for that category linked, so the analyst follows the documented route.

Creating a ticket requires the reviewer to confirm they have checked the workings. That confirmation, the rule versions used, the reconciled transaction ids and the computed figures are written to the audit log, so any ticket traces back to the exact data and rule versions that produced it.

**Rejections improve the rules, not a model.** A rejection records a reason from a controlled list (wrong break type, wrong transactions, wrong signature, figures wrong, not a break, other). A weekly report of rejections by rule shows which tables need correcting.

### 18.9 Verification before trust

1. **Parallel run.** Compute variances daily and compare against the Power BI MTD report for at least a full month. Target: zero unexplained differences for 20 consecutive business days before auto-drafting is enabled.
2. **Back-test.** Replay the last 90 days through the rules and compare against the OTC tickets actually raised: same break type, same reconciled transaction set, same corrections. Differences are investigated as either a rule gap or a historical error. Include the cases the team's own documentation names as validated: the multi-wallet SOL MEV late snapshot, the single-wallet ETH CL late snapshot, and the superseded pair from 25 July 2026 (a partial MEV run affecting Locked only, and a CL-only late set that was Total-neutral).
3. **Precision test.** Assert that every computed correction takes the break date's transaction variation to exactly zero across the back-test set.
4. **Failure-mode test.** Constructed cases that must land as undiagnosed: an unknown transaction type, an overshooting reconciliation, a non-zero balance variation, a masked break and a partial run.

Only after 1 and 2 pass is `mtd.autodraft.enabled` switched on, and every ticket is still reviewed.

### 18.10 Alerts (add to Section 11.2)

| Code | Name | Trigger | Severity |
|---|---|---|---|
| ALR-OTC-01 | MTD breaks awaiting review | Any break for yesterday unreviewed by the check due time | high |
| ALR-OTC-02 | Ticket awaiting workings attachment | Created OTC ticket with no confirmed attachment after 30 minutes | high |
| ALR-OTC-03 | Undiagnosed break rate high | More than N undiagnosed breaks in a day, suggesting a rule gap or a GX change | medium |
| ALR-OTC-04 | Unknown transaction type seen | A transaction type with no `SignRule` appears in a break | medium |
| ALR-OTC-05 | Snapshot restated | An EOD snapshot for a past date changed on re-read | medium |
| ALR-OTC-06 | Break older than T+1 unresolved | An MTD break open past its T+1 target | high |
| ALR-OTC-07 | Duplicate OTC risk | Two open tickets covering the same wallet and break date | critical |

### 18.11 Relationship to the existing skill

The `late-snapshot-otcs` skill stays useful for ad-hoc work and for break types the pipeline does not auto-draft. Once the pipeline is live for late snapshots, the skill should defer to it for that type so the two cannot both raise a ticket. The rule tables in 18.4 and the template in 18.6 become the single source for both, and the skill's reference files should point at them rather than holding a second copy.

### 18.12 Acceptance tests

- Rule tables load, and a transaction type with no signature never produces a correction.
- Reconciliation matches exactly on a fixture and refuses an approximate match.
- A partial run reconciles to the remainder, not the day's total.
- A masked break is attributed to the correct date.
- Every blocking sanity check marks the break undiagnosed rather than drafting.
- The generated workbook has full-precision values, blank (not zero) unadjusted columns, per-wallet subtotals that tie, and no formula errors.
- Duplicate detection blocks a draft for an existing wallet and break date regardless of the existing ticket's age.
- No ticket is created without a recorded human confirmation.
- `no-float-arithmetic-in-mtd` passes.
- The back-test harness runs against fixtures and reports break type, transaction set and correction differences per historical ticket.

**STOP 13.**

---

## 19. Testing, security and quality gates

- **Unit:** every evaluator, metric formula, parser (against fixtures) and enforcement rule.
- **Integration:** use MSW (Mock Service Worker, add it and justify) or Vitest fetch mocks for the Komainu API, Jira and JSM, Slack and Graph. No live network in CI. Add a CI guard that fails if any test makes a real network call (block via a global fetch mock that throws on unmocked hosts).
- **E2E (critical workflows):**
  1. A client Slack question arrives, a JSM request is created, first response is recorded, the item is closed with a write-up, and the metrics update.
  2. An OES settlement fails: the alert fires, a ticket is created, the exchange-contacted tag is added, and the item resolves.
  3. A daily check with an exception creates a ticket.
  4. An attempt to close without a write-up returns 422.
  5. An attempt to acknowledge an alert without a ticket returns 422.
  6. An email in a shared mailbox is raised as a risk entry: an internal ticket is created, a client JSM request is created in the right organisation, a human-sent notification carries the portal link, a public update passes four-eyes, and the item resolves with a client-facing resolution message.
  7. A simulated 24-hour clock shows `sync_slack` and `sync_mail` run every 5 minutes with no out-of-hours gap, and that ALR-HB-SLACK fires after two missed cycles.
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

## 20. CONFIRM register (blocking inputs from humans)

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
| CONFIRM-JSM-INCIDENT-REQUEST-TYPE | JSM request type for client incident and risk notifications, and its portal-visible statuses | Section 9.7 client tickets |
| CONFIRM-JSM-PORTAL | Client portal set-up: customer accounts, organisation membership, branding | Clients viewing their tickets |
| CONFIRM-CLIENT-CONTACTS | Which client contacts become request participants | Section 9.7 |
| CONFIRM-INCIDENT-PROJECT | Internal Jira project for incident and risk entries | Section 9.7 |
| CONFIRM-CLIENT-UPDATE-CADENCE | Maximum time between client updates per severity | ALR-CLI-02 |
| CONFIRM-COMPLIANCE-ROUTE | Where compliance-sensitive entries are routed, and who records the decision | ALR-CLI-03, withheld tickets |
| CONFIRM-GX-RELEASE-PARENT | Confluence parent page and title pattern for GX sprint release notes | Section 16 intake |
| CONFIRM-KMNC-NAMING | KMNC ticket naming for UAT and PROD GX releases | Section 16 timing |
| CONFIRM-GX-IMPACT-RULES | Team review of the seed impact mapping | Section 16 ticket creation |
| CONFIRM-UAT-PROJECT | Jira project and issue type for UAT tickets | Section 16 tickets |
| CONFIRM-UAT-LEAD-DAYS | Business days before PROD that UAT must finish | Due dates, ALR-UAT-02 |
| CONFIRM-UAT-TEMPLATES | Test outlines per mapping row, written by the team | Ticket content |
| CONFIRM-GX-RELEASE-SAMPLE | A redacted real release-notes page for the parser fixture | Parser tests beyond the synthetic template |
| CONFIRM-AUDIT-RETENTION | Regulatory retention period for the audit log | Section 17.7 |
| CONFIRM-OTC-RULE-REVIEW | Team review of the seeded `SignRule` and `BreakTypeRule` tables | Section 18.4, before any drafting |
| CONFIRM-VARIANCE-DEFINITIONS | Confirmation that the recomputed variances match the Power BI definitions | Sections 18.3 and 18.9 |
| CONFIRM-OTC-FIELD-MAPPING | Variance Type and Wallet Type field values per break type | Section 18.7 |
| CONFIRM-CATEGORY-LIST | Final incident and risk categories, and which are compliance-sensitive (Compliance to confirm) | Section 9.7 form |

---

## 21. Pull request plan and definition of done

| PR | Phase | Must include |
|---|---|---|
| 1 | Phase 0: remove approvals, disable AI, scoring, activity and USDC ramp | Deletions, migrations, security tests |
| 2 | Phase 1: worker, SSO, hosting config, egress allowlist | Worker in docker-compose, SSO tests |
| 3 | Phase 2: data model | Migrations, seed of definitions (no real data) |
| 4 | Phase 3: integrations (Komainu API read-only, Jira/JSM, Slack, Graph, imports) | Mocks, health endpoint |
| 5 | Phase 4: client intake, plus raising incidents or risks with client JSM tickets | Route flag, 5-minute polling, rules, Section 9.7 form and linked tickets, tests |
| 6 | Phase 5: ticket enforcement | 422 rules, reports |
| 7 | Phase 6: alerting | Engine, catalogue (all disabled), routing |
| 8a–c | Phase 7: daily coverage by team | Definitions, pulls, evidence, coverage test |
| 9 | Phase 8: metrics | Formulas, reports, per-person guard |
| 10 | Phase 9: UI | Work queue, boards, morning board |
| 11 | Phase 10: Jira inventory | Read-only script output |
| 12 | Phase 11: GX sprint intake and UAT tickets | Parser, impact rules, UAT tickets, gate alerts, spec-diff script |
| 13 | Phase 12: security hardening (parts land earlier, see 17.9) | Headers, CSRF, schemas, scoping, audit immutability, threat model, pipeline gates |
| 14 | Phase 13: MTD diagnosis and OTC drafting | Snapshot and transaction stores, variance engine, rule tables, reconciliation, workings, draft tickets, back-test |

**Definition of done (Phase 1 overall):**

- **CI and constraints:** `npm run ci:check` passes, and every hard constraint in Section 2 has a passing enforcing test.
- **Coverage:** the coverage test passes for all 27 tasks, and each shows in the Work UI with evidence capture.
- **Rules and CONFIRM items:** every alert rule exists, is disabled by default, and cannot be enabled while its CONFIRM params are missing. The CONFIRM checklist shows on `/admin/health`.
- **End-to-end demo against mocks:**
  - a client Slack question, an OES failure and a daily check exception each produce a ticket, SLA timers and metrics, with no manual ticket creation;
  - a Slack message and a shared-mailbox email are each raised as an incident, producing an internal ticket and a client-specific JSM request visible only to that client's organisation;
  - polling has run every 5 minutes through a simulated 24-hour period, including out of hours;
  - a synthetic GX sprint release-notes page produces a UAT parent and mapped child tickets, due before the PROD date, and ALR-UAT-02 fires if outcomes are missing;
  - a seeded late-snapshot break is diagnosed, reconciled exactly, and produces a workings file and a drafted OTC ticket that no code can submit without a human.
- **Documentation updated:**
  - `docs/architecture.md`;
  - `docs/integration-guide.md`;
  - `docs/deployment.md`;
  - a new `docs/phase1/runbook.md`, covering how to enable a rule, add a client channel, rotate credentials, and what to do when the worker heartbeat alert fires.

Nothing may be connected to production data until Security, Compliance and IT sign-off is recorded. That sign-off is outside this repo and is performed by humans.
