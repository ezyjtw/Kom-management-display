# KOMmand Centre: product specification

**Status:** generic product specification. It describes what the product does and the rules it must keep, for any digital-asset custody operations team. It contains no information about a particular firm.

**Deployment requirements are private.** A firm deploying the product keeps its own requirements document (its check list, team structure, projects, thresholds, vendors, regulators and control references) outside this repository. Section numbers used in code comments (`spec §12`, `spec §17.5` and so on) follow the numbering of this document; where a comment names a detail this document does not describe, that detail belongs to the deployment's private requirements.

---

## 0. How to work on this repository

1. **One phase per branch and pull request.** Never mix phases in one PR.
2. **Run `npm run ci:check` before every commit you propose.** It runs Prisma generate, typecheck, lint, tests and build.
3. **Every behaviour needs a test.** Unit tests live in `src/__tests__/`, integration tests in `src/__tests__/integration/`.
4. **Never guess an external format.** Where a message format, field value, threshold or endpoint behaviour is not known, build the code path behind configuration or a feature flag, write the parser against a clearly synthetic fixture, and leave a `TODO(CONFIRM-<id>)` comment. Section 20 lists every open decision; `docs/phase1/confirm-register.md` is generated from it and from the code.
5. **Ask rather than assume** when the code and a requirement disagree.
6. **Do not change Jira or Confluence configuration, workflows, automation or permissions** from code. The product may only create and update work items, comments, assignees, labels, fields and transitions in configured projects.
7. **No firm-specific content.** Names of the deploying firm, its people, clients, partners, regulators, places, projects and internal control references stay out of the repository. `npm run ip:check` enforces a private denylist.

---

## 1. Goal

An operations team runs its whole desk from one screen: recurring tasks and checks, client questions, alerts, vendor tickets and the morning call.

- **Every issue, problem, risk and client question becomes a ticket automatically.** The system creates the ticket; people cannot skip writing it up.
- **Responsiveness is high and measured.** Slack channels and shared mailboxes are polled every 5 minutes, 24/7. SLA clocks start at the client's message or the triggering event, not when someone notices.
- **Incidents and risks raised from a message get a client-specific service-desk ticket** that the client can follow in the portal (Section 9.7).
- **Alerts fire for events that need a human response**, including silence: a feed or check that stops producing data is itself an alert.
- **Platform changes are tested before they reach production** (Section 16).
- **Nothing in the product approves, signs or initiates anything on a custody platform** (Section 2).

---

## 2. Hard constraints (non-negotiable)

Each has an enforcing test.

| # | Constraint |
|---|---|
| H1 | **No transaction approval of any kind.** Nothing may approve, reject, confirm, cancel, sign, create or initiate a transaction, request, wallet, whitelist or collateral operation on any custody platform, including "sign-off" semantics that stand in for an approval. |
| H2 | **Read-only custody API.** The only permitted non-GET call is `POST /v1/auth/token`. The API user must hold no write rights. |
| H3 | **AI off.** `AI_PROVIDER` defaults to `none` and the `ai.enabled` flag is `false`. |
| H4 | **No staff surveillance.** No performance scoring, screen monitoring, keystroke logging, location or live activity tracking. Metrics are team and client level only. |
| H5 | **No local risk scoring.** Risk levels come from the custody source system, never from a local re-implementation. |
| H6 | **No new wallet or key technology.** The product never generates, stores or manages private keys. |
| H7 | **No secrets in code, fixtures, seeds or logs.** Secrets come from mounted files or, outside production, environment variables validated in `src/lib/env.ts`. |
| H8 | **Redaction.** Wallet addresses, tx hashes, client names, account numbers, IPs and geolocation are redacted in logs. |
| H9 | **No production targets in development or tests.** Tests use mocks or `custody-demo.example.com`. |
| H10 | **No platform-specific hosting files** (`railway.json`, `railway.toml`, `Procfile`). |
| H11 | **Travel-rule connector disabled by default** (`integration.notabene.enabled=false`). |
| H12 | **Client-visible content is human-written and client-scoped.** A client-facing request or public comment contains only that client's information, is written or approved by a named person, and is never generated automatically or by AI. Compliance-sensitive categories never create client-visible tickets without a recorded Compliance decision (tipping-off risk). |

---

## 3. Repository orientation

Next.js App Router (React 19), TypeScript strict, Prisma on PostgreSQL, Zod for all external input, NextAuth with OIDC single sign-on. A separate worker process (`KOM_WORKLOAD=worker`) runs pollers and scheduled jobs. See `docs/architecture.md`.

## 4. Target architecture

```
Sources (read)                  Core                                   Systems of record (write-back: ownership, status, comments)
custody API (GET only) ─┐
Slack                  ─┤  adapters → normalised events → • WorkItem (single queue)      ┌─> service desk (client requests, SLAs)
Shared mailboxes       ─┼─────────────────────────────── • Alert engine and rules  ─────┤
Jira / service desk    ─┤                                 • Ticket enforcement          └─> Jira projects (configured)
Imports (CSV)          ─┤                                 • SLA clocks and metrics
Vendor notifications   ─┘                                 • Daily-check engine, heartbeats
                        UI: Work queue · Team boards · Daily checks · Alerts · Clients · Metrics · Morning board
```

1. **WorkItem is the single queue.** Every actionable thing is a `WorkItem` linked to exactly one ticket.
2. **The ticket is the record; the product is the view.** Changes are written to the ticket first; a failed write-back is an error, never a silent divergence.
3. **Everything is idempotent** by `(sourceSystem, sourceId)`.
4. **All times are stored in UTC** and displayed in the deployment's business timezone, with a per-user timezone.

## 5. Phase 0: remove transaction approval and unsafe features

Approval routes and clients are deleted; the transaction-confirmation view is a read-only tracker of source-flagged transactions awaiting a human on the custody platform. AI features, per-person scoring, live activity tracking and the fiat ramp are behind flags that default off, with navigation hidden and routes returning 404 when off.

## 6. Phase 1: platform foundations

An always-on worker; OIDC single sign-on (local login only in development and on the demo tier); hosting configuration without platform-specific files; an egress allowlist enforced by the HTTP client (`src/lib/http/allowed-hosts.ts`).

## 7. Phase 2: core data model

`Client` (with external identifiers per source), `WorkItem`, `SlaPolicy` and clocks, `Alert` and `AlertRule`, `SourceHeartbeat`, `DailyCheckDefinition` and `DailyCheckItem`, `TimeLog` (client effort, no per-person reporting), ticket links and incident-log drafts. Reference data ships inactive or disabled.

## 8. Phase 3: integrations

- **Custody API (read-only):** balances, transactions, requests, settlements, audit events; GET only, token auth, per-workspace credentials.
- **Jira and service desk:** read plus limited write-back (create, comment, assign, transition) in configured projects only (`JiraProjectConfig`, all disabled by default).
- **Slack:** polling every 5 minutes, 24/7, of registered channels; bot scopes in `docs/phase1/slack-scopes.md`.
- **Microsoft 365 (Graph):** shared mailboxes, read-only, application access limited to named mailboxes.
- **Imports:** CSV templates for sources without an API; a template without a confirmed format refuses uploads.

Vendor adapters keep the names of the public APIs they implement; documentation and UI refer to vendor roles (custody platform, travel-rule provider, chain-analytics provider, wallet infrastructure).

## 9. Phase 4: client questions become tickets

One intake route is active at a time (service-desk native or the product's own rules). Priority rules are deterministic. Email and Teams follow the same rules.

### 9.7 Raise an incident or risk from a message

Any team member can raise an incident or risk from a Slack message or email. The product creates an internal ticket and, where appropriate, a client-specific service-desk request visible only to that client's organisation. Public updates are written by a named person and, for P0/P1, approved by a second person. Compliance-sensitive categories withhold the client ticket until Compliance records a decision (H12).

## 10. Phase 5: tickets by default

Alerts, failed checks, client questions and vendor issues raise tickets automatically. Closing without a write-up, or acknowledging an alert without a ticket, is refused (422). A daily report finds unticketed work; a reconciliation finds divergence between tickets and work items. Incident-log drafts are created only when the log owner has agreed.

## 11. Phase 6: alerting engine

Rules are data (`AlertRule`: code, enabled, severity, params, route) evaluated by pure evaluators. Every rule ships disabled and cannot be enabled while a CONFIRM parameter is missing. Routing is by role and business hours; escalation is configured per rule. Risk signals are read from the custody source system (H5).

## 12. Phase 7: coverage of daily work

Each recurring check or task is a `DailyCheckDefinition`: team, frequency, due time, evidence required, ticket project, procedure link and, where possible, an automated data pull. Positive evidence is mandatory: a record count and a data date; a blank result is not a pass. The catalogue in `src/modules/daily-checks/definitions.ts` is an example set; a deployment edits it through the admin UI. Known issues per check are deployment data and ship empty.

## 13. Phase 8: metrics and SLAs

Formulas in `src/modules/metrics/definitions.ts`, each unit-tested. Team and client level only; a test refuses per-person metrics (H4).

## 14. Phase 9: the single work interface

Work queue, team boards, work item detail, morning board with lead handover, and responsiveness indicators that never rely on colour alone.

## 15. Phase 10: Jira rationalisation support

A read-only inventory script reports projects, issue types and usage. It changes nothing.

## 16. Phase 11: platform change intake and UAT tickets

Release notes for each platform sprint are read from Confluence (read-only), parsed into changes, and mapped to affected checks and alerts by configurable impact rules (`PlatformImpactRule`, shipped inactive). UAT tickets are created for affected changes and are due before the production date; missing outcomes raise an alert.

## 17. Phase 12: security architecture

- **17.3 Identity and secrets:** OIDC SSO with group-to-role mapping; secrets from mounted files in production; step-up re-authentication for sensitive actions; 12-hour absolute sessions.
- **17.4 Application hardening:** nonce CSP, CSRF double-submit plus Origin check, strict input validation, idempotent mutations (`Idempotency-Key`, duplicate-submission guard).
- **17.5 Data protection:** client scoping in one module (`src/modules/auth/client-scope.ts`); out-of-scope ids answer 404.
- **17.6 Supply chain:** pinned actions and images, SBOM, dependency, secret, SAST and image scanning.
- **17.7 Logging and detection:** fail-closed audit for control, security, financial, configuration and administration actions; `AuditLog` and `BackgroundJobRun` are append-only in the database; security alerts (ALR-SEC-*).
- **17.8 Threat model:** `docs/phase1/threat-model.md`.

## 18. Phase 13: deterministic break diagnosis

Given custody balance and transaction data, the product recomputes daily variances, diagnoses each break against rule tables (`SignRule`, `BreakTypeRule`), reconciles it exactly and drafts a ticket with workings. A human reviews and submits every draft.

## 19. Testing, security and quality gates

Unit tests for every evaluator, formula, parser and enforcement rule; integration tests against mocks only (no live network in CI); security tests for every hard constraint; data retention for message bodies, raw payloads and time logs (CONFIRM-RETENTION).

---

## 20. Open decisions (CONFIRM register source)

Each item gates the listed rules or features, which stay disabled until it is resolved by the deploying firm. `npm run confirm:register` cross-references this table with the `TODO(CONFIRM-*)` markers in the code.

| ID | What is needed | Blocks |
|---|---|---|
| CONFIRM-SLA-TARGETS | Internal SLA targets per policy (ownership, first response, resolution) | SLA alerts, attainment metrics |
| CONFIRM-RISK-SOURCE | Where platform risk levels can be read (bot posts with samples, or an internal feed) | ALR-RSK-* |
| CONFIRM-RISK-COMMITTEE | The firm's ratified risk tier mapping and approval wording | Tier switch in `RiskRuleTier` |
| CONFIRM-RSK-MED-MINS / HIGH-MINS | Clocks for pending medium and high | ALR-RSK-01/02 |
| CONFIRM-API-SCOPE | Whether one read-only API user can see all workspaces | custody API aggregation |
| CONFIRM-SETTLEMENT-STATUS | Actual `status` values for settlements, operations and portfolios | ALR-OES-* |
| CONFIRM-OES-WINDOWS | One reference time per exchange settlement window | ALR-OES-* |
| CONFIRM-VENUE-WINDOWS | Settlement windows and contacts for each exchange venue | Venue windows |
| CONFIRM-AUDIT-EVENTS | Audit-log event names for tap rule, whitelist and risk-parameter changes | ALR-CFG-01 |
| CONFIRM-BANK-TEMPLATES / ACK-MINS / VALUE-DATE-CUTOFF / PROJECT / FEE-ALERT-FORMAT / FEE-THRESHOLDS | Partner bank email formats, clocks, Jira project and fee alerting | `module.bank`, ALR-BANK-* |
| CONFIRM-MAILBOXES | Mailbox addresses and purposes; mail access policy | Graph mail |
| CONFIRM-VENDOR-FORMATS | Redacted vendor notification samples | Vendor parsing |
| CONFIRM-CHAINALYSIS-EXPORT / MTD-EXTRACT / INBOUND-EXTRACT / TATUM | Export templates | CHK-04, 02, 05, 15 imports |
| CONFIRM-NFT-SOURCE | Where pending NFTs are listed | CHK-07 automation |
| CONFIRM-PROJECT-ROLES | Purpose of the EXT project for this team | Project config |
| CONFIRM-RISK-SCORE-SCALE | The team's ticket risk score scale | Closure validation |
| CONFIRM-INCIDENT-LOG-OWNER | Incident log owner agreement to automated drafts | `incident_log.drafts.enabled` |
| CONFIRM-CHECK-GAPS | Numbering gaps in the team checklist | Coverage sign-off |
| CONFIRM-REALISATION-THRESHOLD | Current risk committee realisation threshold | ALR-RLS-01 |
| CONFIRM-RETENTION | Retention periods | Retention jobs |
| JSM Slack verification | Service-desk Slack integration checklist completed | `intake.slack.route=jsm_native` |
| CONFIRM-JSM-INCIDENT-REQUEST-TYPE | Request type for client incident and risk notifications, and its portal-visible statuses | Client incident tickets |
| CONFIRM-JSM-PORTAL | Client portal set-up: customer accounts, organisation membership, branding | Clients viewing their tickets |
| CONFIRM-CLIENT-CONTACTS | Which client contacts become request participants | Client incident tickets |
| CONFIRM-INCIDENT-PROJECT | Internal Jira project for incident and risk entries | Client incident tickets |
| CONFIRM-CLIENT-UPDATE-CADENCE | Maximum time between client updates per severity | ALR-CLI-02 |
| CONFIRM-COMPLIANCE-ROUTE | Where compliance-sensitive entries are routed, and who records the decision | ALR-CLI-03, withheld tickets |
| CONFIRM-PLATFORM-RELEASE-PARENT | Confluence parent page and title pattern for platform release notes | Change intake |
| CONFIRM-CHG-NAMING | Change-ticket naming for UAT and PROD platform releases | Change intake timing |
| CONFIRM-PLATFORM-IMPACT-RULES | Team review of the seed impact mapping | UAT ticket creation |
| CONFIRM-UAT-PROJECT | Jira project and issue type for UAT tickets | UAT tickets |
| CONFIRM-UAT-LEAD-DAYS | Business days before PROD that UAT must finish | Due dates, ALR-UAT-02 |
| CONFIRM-UAT-TEMPLATES | Test outlines per mapping row, written by the team | Ticket content |
| CONFIRM-PLATFORM-RELEASE-SAMPLE | A redacted real release-notes page for the parser fixture | Parser tests beyond the synthetic template |
| CONFIRM-AUDIT-RETENTION | Regulatory retention period for the audit log | Audit retention |
| CONFIRM-OTC-RULE-REVIEW | Team review of the seeded `SignRule` and `BreakTypeRule` tables | Break drafting |
| CONFIRM-VARIANCE-DEFINITIONS | Confirmation that the recomputed variances match the firm's report definitions | Break diagnosis |
| CONFIRM-OTC-FIELD-MAPPING | Variance Type and Wallet Type field values per break type | Break ticket drafting |
| CONFIRM-CATEGORY-LIST | Final incident and risk categories, and which are compliance-sensitive (Compliance to confirm) | Incident form |

---

## 21. Definition of done

- `npm run ci:check` passes and every hard constraint in Section 2 has a passing test.
- Every alert rule exists, is disabled by default and cannot be enabled while its CONFIRM parameters are missing.
- The demo tier (`KOM_ENVIRONMENT=demo`) runs end to end on synthetic data; `npm run go-live:check` passes before any production start (`docs/phase1/go-live.md`).
- Nothing is connected to production data until the deploying firm's Security, Compliance and IT sign-off is recorded. That sign-off happens outside this repository.
