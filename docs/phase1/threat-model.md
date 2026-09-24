# KOMmand Centre threat model

**Scope:** Phase 1, this repository at the end of Phase 12.
**Method:** STRIDE for each trust boundary, plus the Komainu-specific abuse cases in spec §17.8.
**Status:** a draft for the design review with Platform Security. Nothing here has been reviewed yet.
**Owner:** TODO(CONFIRM-SERVICE-OWNER).

## 1. What the system is, and what it is not

KOMmand Centre is an operations dashboard. It:

- reads from Komainu (GET only), Jira and JSM, Confluence, Slack and Microsoft Graph;
- turns what it reads into work items, alerts and checks for the operations team;
- writes to Jira and JSM, to Slack channels, and to mailboxes through Graph.

Every client-visible write is made by a named person.

It sits entirely **outside the custody trust boundary**:

- It holds no key material.
- It has no signing, vault or custody domain.
- It has no code path that approves, rejects, confirms, cancels, initiates or signs a transaction or request on any custody platform (H1).

The Komainu API client allows only GET, plus `POST /v1/auth/token`, and only against a frozen allowlist of endpoints (H2). A test enforces this (`custody-client-is-read-only`). This is the architectural answer to the most serious abuse case: a compromised dashboard cannot move client funds, because the capability does not exist.

## 2. Components and trust boundaries

```
Browser ──(1)── Web app (Next.js, Node 22) ──(2)── PostgreSQL
                      │
Worker (same image) ──┼──(3) Komainu API (read only)
                      ├──(4) Atlassian (Jira, JSM, Confluence)
                      ├──(5) Slack
                      ├──(6) Microsoft Graph (mail, Teams)
                      └──(7) Client-visible JSM content (portal requests, public comments)
```

The worker (8) crosses boundaries 2 to 7 with the same code and the same egress allowlist.

Controls at the edge and in the network come from the Azure platform, not from this repository. They must be in place before the first deployment to a shared environment (spec §17.2, §17.9):

- private access;
- a WAF running the OWASP Core Rule Set;
- TLS termination;
- the network-level egress allowlist.

The in-code controls below assume those exist, and do not replace them.

## 3. STRIDE by boundary

### (1) Browser to web app

| Threat | Mitigation in code | Evidence |
|---|---|---|
| **S**poofing: a stolen session or password | Entra ID SSO only in production; no local passwords (the credentials provider is not registered); roles come from Entra group membership (PIM-eligible for admin, §5). Session: `httpOnly`, `secure` and `sameSite=lax` cookies, `__Host-` prefix on HTTPS, 12 h absolute lifetime (`authTime`), 1 h idle timeout, server-side revocation list (`SessionMetadata`), sign-out revokes. | `prod-has-no-credentials-provider`, `route-permissions` |
| Spoofing: a stale session used for a sensitive action | Step-up: sensitive actions need a sign-in within the registry's window; the API answers 401 `REAUTH_REQUIRED` and the browser re-authenticates with `prompt=login`. This proves a *recent* sign-in, not a fresh MFA challenge. Entra authentication context (true MFA step-up) is future work (§8). | `step-up-reauth` |
| **T**ampering: cross-site request forgery | Double-submit CSRF token (cookie plus header, compared in constant time) and an Origin/Referer check, both in middleware, so a new route cannot forget them. Exempt only: signed webhooks, the cron trigger (bearer secret), the NextAuth flow. | `csrf-required-on-mutations` |
| Tampering: script injection | Nonce-based CSP for scripts (no `unsafe-inline`, no `unsafe-eval` in production); `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`; no `dangerouslySetInnerHTML` anywhere (email previews render in a sandboxed iframe). | `security-headers-present`, `no-dangerously-set-inner-html`; checked in Chromium against `next start` |
| **R**epudiation | Every state change writes AuditLog, which records the actor (Employee), the principal (User), action, target, result and correlation id. Control-relevant changes are fail-closed (§6). | `control-mutations-fail-closed`, `audit-integrity` |
| **I**nformation disclosure | Server-side authorisation on every route (matrix plus record scope); client isolation through one helper (by-id access to another client's item returns 404); safe error model (a code and a message, never a stack, SQL or upstream payload); `Referrer-Policy: same-origin`; `X-Powered-By` removed. | `api-route-guards`, `client-scoping-enforced`, `authorization-matrix` |
| **D**enial of service | Shared rate limits in PostgreSQL across replicas (search, export, reports, sign-in), per user and per IP, fail-closed; a daily export cap per user (ALR-SEC-03); input shape limits (depth 10, arrays 1,000, strings 100k, keys 500). The WAF and edge limits are the first line. | `shared-rate-limit`, `security-alerts` |
| **E**levation of privilege | Role gates in middleware *and* in each route; auditors are read-only; admin only through a PIM-activated group; an SSO sign-in never overwrites the database role with a stale one (fixed in 12a); role changes raise ALR-SEC-02. | `route-permissions`, `security-alerts` |

### (2) App to database

| Threat | Mitigation |
|---|---|
| Tampering with the audit trail | AuditLog is append-only by trigger: UPDATE, DELETE and TRUNCATE are rejected (migration 0037). The application's database role has SELECT and INSERT only on AuditLog, cannot drop or disable triggers, and cannot alter the trigger functions (`docs/phase1/db-roles.sql`, verified on PostgreSQL 16). BackgroundJobRun gets the same treatment, except that deletion is allowed after the retention period (migration 0042). |
| Spoofing: a stolen connection string | Production connects with the workload's managed identity (no password in `DATABASE_URL`, TODO(CONFIRM-DB-IDENTITY)); a private endpoint only; TLS enforced. |
| Injection | Prisma parameterises all queries. The few raw statements use tagged templates (`$queryRaw`), never string concatenation. External content is never used to build a query (§17.4). |
| Schema drift weakening a control | Migration drift check that blocks CI (baseline empty since migration 0043; `schema-drift.md`). |

### (3) App to Komainu API

| Threat | Mitigation |
|---|---|
| The dashboard is used to act on custody | GET only, with a frozen endpoint allowlist; the Komainu API user is read-only on the Komainu side (H2). |
| Credential theft | Secret held in Key Vault and mounted as a tmpfs file (never an environment variable, which fails startup in production). Every use is audited with the credential label and the workload (`integration_credential_used`). Repeated 401/403 raises ALR-SEC-05. |
| Wrong environment | Only `api-demo.komainu.io` or mocks in code and tests; `.env.example` holds no production endpoint (H9). |

### (4) App to Atlassian, (5) Slack, (6) Graph

| Threat | Mitigation |
|---|---|
| Stolen token | tmpfs secrets; project-scoped Atlassian service account without admin rights; Slack app with the minimum scopes (`slack-scopes.md`); Graph restricted to named mailboxes by an Exchange application access policy; ALR-SEC-05 on repeated 401/403; a revoke-first procedure (`credentials.md`). |
| Forged inbound events | Slack requests are verified by signing secret and timestamp; Jira webhooks by shared secret; both are exempt from CSRF only because they carry their own proof. |
| Malicious content (a Slack message, an email or a vendor notice) manipulating the system | All external content is parsed as data: never executed, evaluated, used to build a query, or treated as an instruction. AI is off (H3), so there is no prompt path. Enabling AI needs its own review of the indirect prompt-injection risk. |
| Data exfiltration through outbound calls | A code-level egress allowlist (`httpFetch`; the only way server code makes HTTP requests) plus the network allowlist. |

### (7) Client-visible JSM content

| Threat | Mitigation |
|---|---|
| One client's information leaks to another | Client scoping plus cross-client text checks before anything client-visible is created (§9.7); a client ticket carries only that client's information. |
| Automated or AI-written client content | Client-visible content is written or approved by a named person, never auto-posted, never AI-generated (H12); approval and dismissal are fail-closed audited. |
| Tipping off | Compliance-sensitive categories never create a client-visible ticket without a recorded Compliance decision (H12, test `compliance-sensitive-blocks-client-ticket`). |

### (8) Worker

The worker is the same image and code, with the same egress allowlist and the same secret loader, labelled `KOM_WORKLOAD=worker` for credential-use audit. Polling runs 24/7 and is never paused out of hours. Heartbeats raise ALR-HB-* when polling stops. Durable run history (BackgroundJobRun) keeps failures and dead letters as evidence.

## 4. Komainu-specific abuse cases (spec §17.8)

| Abuse case | Mitigation | Where |
|---|---|---|
| A compromised dashboard session is used to move client funds | No custody write path exists (H1, H2); the Komainu API user cannot write | `custody-client-is-read-only`, `no-approval-routes` |
| An operator leaks one client's data to another through a client ticket | Server-side client scoping and cross-client text checks | `client-scoping-enforced`, `client-ticket-scoped-to-one-client` |
| Tipping off a client under investigation | Compliance-sensitive categories never auto-create client-visible tickets | `compliance-sensitive-blocks-client-ticket` |
| An attacker suppresses an alert to hide an incident | Alerts cannot be cleared without a ticket; audit is append-only in the database and for the application role; SecOps receives the log stream | `ticket-enforcement`, `audit-log-is-append-only` |
| A malicious Slack message or vendor email manipulates the system | All external content is data; no execution path; AI off | §3 (4) to (6) |
| The Atlassian token is stolen | Project-scoped permissions, tmpfs storage, rotation, ALR-SEC-05, revoke-first procedure | `credentials.md` |
| An insider edits an alert rule to stop a control firing | Rule changes need a PIM-activated admin, are fail-closed audited, and raise ALR-SEC-02 (one ticketed alert per change) | `security-alerts` |
| Stale data causes a missed break | Heartbeats and freshness indicators on every view | ALR-HB-* |
| The application credentials are used to rewrite history | No UPDATE, DELETE or TRUNCATE, and no DDL, for the application role on evidence tables | `db-roles.sql` |

## 5. Privileged access and break-glass

- **No standing admin.** The KOMmand `admin` role, which can change alert rules, SLA policies, impact mappings, settings and client mappings, comes from an Entra group that is **PIM-eligible**, with approval and time-bound activation, mirroring O1. Day-to-day users hold `employee` or `lead`. The group-to-role mapping is `ROLE_GROUP_MAP`; a user in no mapped group is denied. TODO(CONFIRM-PIM-GROUP): the group id and its approvers.
- **Break-glass.** If Entra is unavailable, recovery follows the existing application-admin pattern held by IT and Security, not a local password. Production never registers the credentials provider. Any production sign-in that does not come through Entra raises **ALR-SEC-04** (critical) and is reviewed.
- **Access reviews** follow the IT periodic cadence; KOMmand is registered in the IT Services inventory with a service owner and an access-review owner (TODO(CONFIRM-SERVICE-OWNER)).

## 6. Audit policy

Every mutation route is classified in `src/lib/api/audit-policy.ts`:

- **Control, security, financial, configuration and administration** changes are fail-closed. A "requested" entry is written first; if it cannot be written, the action does not run (HTTP 503). The outcome is then recorded as "completed" or "failed" with the same correlation id. ALR-AUD-01 flags any "requested" entry that never got an outcome.
- **Normal operational work** (inbox triage) may be fail-open.
- Every fail-closed route now uses the fail-closed helpers; the tracked-gap list (`AUDIT_GAPS`) has been empty since Phase 12g, and the test `control-mutations-fail-closed` keeps it that way.

## 7. Reviewed exceptions

| Exception | Why | Compensating control | Review |
|---|---|---|---|
| CSP `style-src 'unsafe-inline'` | The UI libraries inject `<style>` elements without a nonce, and a style nonce would make browsers ignore `'unsafe-inline'`. | Styles cannot run script; scripts are nonce-only. | TODO(CONFIRM-CSP-STYLES) |
| Unknown request fields are **stripped**, not rejected | Rejecting them would break older clients during the cutover; stripped fields never reach the handler. | Zod schemas on every body-reading route; placeholder schemas are refused by test; input shape limits. | Revisit after cutover |
| Origin/Referer plus double-submit token for CSRF, rather than a synchroniser token | Stateless and works across replicas; the token is per browser, not per form. | `SameSite=Strict` host-only cookie, constant-time compare, Origin required in production. | Accepted |
| Middleware runs on the Node.js runtime, not Edge | Needed to read secrets through the file loader. | None needed. | Accepted |
| Amount inputs still accept JSON numbers | Backward compatibility for existing forms. | Stored as Decimal(38,18) or Decimal(20,2); strings are preferred. | Numbers are refused from **2027-03-31** (enforced by test `amount-number-input-sunset`) |
| Demo tier (`KOM_ENVIRONMENT=demo`) takes secrets from environment variables and may allow local login and seeding | A hosted demo on synthetic data (Railway) cannot mount Key Vault files, and the owner wants a demo before the APIs are connected. | Only when named explicitly (a production build defaults to the production tier). Every page shows a DEMO banner. Never connected to live systems (H9). A production-tier start refuses a database carrying the demo marker, and `go-live:check` fails on the demo tier, environment-variable secrets, local login, seeding or seeded identities. | Accepted by the owner, 2026-09-24 (`go-live.md`) |
| Container image scan uses Trivy, not Wiz | The Wiz CI integration is not wired yet. | Critical and high with a fix available fail the build. | TODO(CONFIRM-WIZ-CI) |

## 8. Residual risks and future work

- **MFA step-up.** Session freshness is not proof of MFA. Use the Entra authentication context (the `acrs` claim) for role changes, security settings, bulk export and destructive admin actions.
- **Signed commits and images, and signature verification at deploy (SLSA 1).** Not wired yet. TODO(CONFIRM-SIGNING).
- **Log shipping.** Depends on the platform's collector (see `logging.md`).
- **Competency-based cover.** Cover eligibility is currently the deputy plus the configured team members. Competency is not modelled.

## 9. Review route

1. Threat model and design review with Platform Security.
2. Engineering security review of the authentication, authorisation and integration code.
3. Pipeline scanning clean.
4. Application penetration test.
5. Findings remediated and retested.
6. Sign-off recorded before any production credential is issued.
