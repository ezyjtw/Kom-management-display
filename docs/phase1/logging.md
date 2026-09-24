# Logging, audit and SIEM onboarding

Spec §17.7 asks for three things:

- the audit stream and application logs reach the tenant's log platform, so SecOps can correlate KOMmand events with Entra sign-ins;
- the log schema is documented;
- a source-onboarding note exists.

This page covers all three.

## 1. Two streams

| Stream | What | Where it is written | How it reaches the SIEM |
|---|---|---|---|
| **Application log** | Operational and security events: requests, errors, `SECURITY:` events, integration failures | JSON lines on stdout (stderr for `error`) when `NODE_ENV=production` (`src/lib/logger.ts`) | The container platform's log collector (Azure Monitor / Container Insights → Log Analytics) → Sentinel. Nothing in the app ships logs itself. TODO(CONFIRM-SIEM): the workspace, table and retention SecOps want. |
| **Audit log** | Who did what to which record, with the outcome. The evidence trail. | The `AuditLog` table, which is append-only (triggers plus database role) | Export by the read-only role (`kom_read`), either a scheduled query into Log Analytics or a diagnostic export. TODO(CONFIRM-SIEM): pull or push, and how often. Each security event is **also** logged as a `SECURITY:` line in the application log, so near-real-time detection does not wait for the export. |

## 2. Application log schema

In production each line is one JSON object:

| Field | Type | Always | Notes |
|---|---|---|---|
| `timestamp` | ISO 8601 UTC | yes | |
| `level` | `debug` \| `info` \| `warn` \| `error` | yes | Minimum level comes from `LOG_LEVEL` (default `info`) |
| `message` | string | yes | Redacted (§4) |
| `type` | string | no | `api_request`, `api_response`, `security`, `db_query` |
| `securityEvent` | `true` | on security events | `message` starts with `SECURITY:` |
| `method`, `route`, `statusCode`, `durationMs` | | on request and response lines | `route` is the path, with no query string |
| `requestId` / `correlationId` | string | when known | Also returned to the client as `x-request-id` / `x-correlation-id`, and set per request by the middleware |
| other keys | | | Context from the caller, redacted |

### Security events (`type: "security"`)

| Message | Emitted when | Context |
|---|---|---|
| `SECURITY: Permission denied` | Any 403, from middleware or a route | `method`, `path`, `role` |
| `SECURITY: Integration authentication failure` | A connector answers 401 or 403 | `host`, `status` |
| `SECURITY: Rate limit exceeded` / `Daily export cap exceeded` | A shared limiter refuses a request | `limiter`, `path`, `scope` |
| `SECURITY: Login rate limited` / `Failed login attempt` | Development local login only; there is no local login in production | |
| `SECURITY: SSO login denied` | An Entra user is not mapped to a role or an employee | `reason` |
| `SECURITY: Egress blocked` | Outbound call to a host that is not allowlisted | `host` |

## 3. Audit log schema (`AuditLog`)

| Column | Meaning |
|---|---|
| `id` | cuid |
| `createdAt` | UTC timestamp |
| `action` | What happened, e.g. `work_item_closed`, `permission_denied`, `role_changed`, `client_comms_approved` |
| `entityType`, `entityId` | The target |
| `userId` | The Employee who acted, or `"system"`. A database trigger converts a User id to its Employee. |
| `actorUserId` | The signed-in principal (`User.id`); no FK, so it survives user removal |
| `actorType` | `user` \| `system` \| `service` |
| `phase` | `recorded` (a single entry), or `requested` → `completed` \| `failed` for a fail-closed action |
| `correlationId` | Links the requested and outcome entries of one action |
| `details` | JSON text: `summary`, `before`, `after`, `metadata`, `outcome`, `error` |

**Result** is carried by `phase` (`completed` or `failed`, with `outcome` or `error` in `details`). A `requested` entry with no outcome after 10 minutes raises ALR-AUD-01.

### Events spec §17.7 requires, and the action names

| Event | `action` (and `entityType`) |
|---|---|
| Sign-in, sign-out | `login_success`, `login_failed`, `sso_login_denied`, `logout` (session) |
| Permission denied | `permission_denied` (route; `entityId` = "METHOD /path") |
| Role change | `role_changed` (user; `metadata.source` = `sso_group` \| `admin`), `user_created` |
| Alert rule or SLA policy change | `alert_rule_updated` (alert_rule), `sla_policy_updated` (sla_policy), `reference_<table>_upserted` / `_deleted` (reference_data, including GX impact rules), `app_setting` changes, feature flag changes |
| Client or channel mapping change | `client_created`, `client_updated` (client), `slack_channel_register`, `slack_channel_update`, `slack_channel_queue_set` (slack_channel), `client_preference_*` |
| Export | `export`, `report_generated`, `export_cap_exceeded` |
| Client-visible content posted | `client_comms_approved`, `client_message_sent`, `client_ticket_created`, `client_update_submitted` (work_item) |
| Compliance-sensitive withholding and override | `client_incident_raised` / `client_risk_raised` with `outcome.withheld`, `client_ticket_released_after_compliance_decision` (work_item; spec §9.7) |
| Komainu API credential use | `integration_credential_used` (integration_credential; `entityId` = `komainu_api:<label>`, `metadata.workload`) |
| Integration credential failure | `integration_auth_failure` (integration_host) |
| Break-glass / non-SSO access | `non_sso_login` (session), which also raises ALR-SEC-04 |

## 4. Redaction (H8)

The logger redacts before anything is written (`src/lib/log-redaction.ts`; test `logger-redacts-sensitive-fields`):

- **Secret-shaped keys are masked:** password, secret, token, api key, authorization, cookie, credential, private key, signature.
- **Identifying keys are masked:** address, tx hash, account numbers, wallet, client name, IBAN, email, phone, IP address, user agent, `x-forwarded-for`.
- **Free-text and location keys are dropped entirely:** `body`, `text`, `html`, `content`, `note`, geo and location fields, latitude and longitude.
- **Values are masked by pattern wherever they appear:** IPv4 and IPv6 addresses, EVM addresses and hashes, Bitcoin addresses, 64-hex hashes, base58 strings.

The audit log keeps the identifiers the evidence needs. It is protected by access control (the `kom_read` role) rather than by redaction.

## 5. Retention

- **Audit log:** at least the regulatory record-keeping period (TODO(CONFIRM-AUDIT-RETENTION) with Compliance). The application never deletes audit rows, and its database role cannot.
- **Other data:** the retention jobs are in `src/lib/data-retention.ts` (TODO(CONFIRM-RETENTION)). Background job runs are deleted only after 30 days (succeeded) or 400 days (anything else); the database enforces this.
- **Application logs:** the Log Analytics retention agreed with SecOps.

## 6. Detection use cases proposed to SecOps

SecOps owns the rules; these are proposals.

1. Repeated authorisation failures for one user, or across users (`permission_denied`; in-app ALR-SEC-01).
2. An export volume spike, or an export by a user who does not normally export (`export`, `export_cap_exceeded`; ALR-SEC-03).
3. An alert rule or SLA policy changed outside change hours (`alert_rule_updated`, `sla_policy_updated`; ALR-SEC-02).
4. A client mapping changed and then immediately used to raise a client ticket (`slack_channel_*` or `client_updated`, followed by `client_incident_raised` / `client_risk_raised` for the same client).
5. The Komainu API credential used from an unexpected workload (`integration_credential_used` whose `metadata.workload` is not `worker`).
6. The worker heartbeat lost while alerts remain unacknowledged (ALR-HB-*).
7. A production sign-in not through Entra (`non_sso_login`; ALR-SEC-04). Correlate with Entra sign-in logs by user and time.

## 7. Source onboarding note (for SecOps)

- **Source name:** KOMmand Centre (web and worker containers, one image, `KOM_WORKLOAD=web|worker`).
- **Format:** JSON lines, UTC timestamps. Security events carry `securityEvent=true`.
- **Identity fields for correlation:** `actorUserId` (KOMmand User id, which maps to the Entra UPN through the `User.email` column), `userId` (Employee), `correlationId`.
- **Volume:** low. Requests at info level, plus polling every 5 minutes per source.
- **Contact:** the service owner in the IT Services inventory (TODO(CONFIRM-SERVICE-OWNER)).
