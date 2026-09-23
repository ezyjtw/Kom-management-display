# Integration Guide

KOMmand Centre reads from external systems and, for Jira/JSM only, writes back
a small allowlisted set of changes. Every connector:

- is an `IntegrationAdapter` registered in `src/modules/integrations/registry.ts`;
- reports health from the `SourceHeartbeat` table (shared by the web and worker
  processes), via `getHealth()`;
- runs its HTTP calls through `CircuitBreaker.for(<name>)`;
- makes every outbound request through `src/lib/http/client.ts`, which enforces
  the egress allowlist (`src/lib/http/allowed-hosts.ts`) and retries 429 / 5xx
  with backoff for reads.

Polling runs in the always-on worker (`src/worker`); job cadences are in
`registerDefaultJobs()` (`src/lib/background-jobs.ts`).

## Health

`GET /api/integrations/health` (admin) returns one entry per connector:

| Status | Meaning |
|---|---|
| `disabled` | Switched off by feature flag (Notabene, H11) |
| `unconfigured` | Credentials not set |
| `healthy` | Every heartbeat succeeded within 2 × its expected interval |
| `degraded` | Some heartbeats are stale |
| `down` | No heartbeat is fresh |

## Komainu API (read-only, H2)

| | |
|---|---|
| Code | `src/lib/integrations/komainu-api/`, pollers in `src/modules/integrations/komainu/` |
| Auth | `POST /v1/auth/token` per API user; token cached until 60 s before expiry |
| Credentials | `KOMAINU_API_USER`/`KOMAINU_API_SECRET`, or several users via `KOMAINU_API_CREDENTIALS` (JSON `[{label, user, secretRef}]`; `secretRef` names a `KOMAINU_API_SECRET_*` env var) |
| Allowlist | `endpoints.ts`; any other path, or any non-GET method, throws before a request is made |
| Storage | Latest state per record in `SourceRecord` (source `komainu_api`); only needed fields |

Polling: requests every minute, transactions every 2 minutes, collateral
(settlements, operations, portfolios) every 10 minutes, audit logs every 5
minutes (sliding 10-minute window), EOD balances 07:00 UTC, staking rewards
07:30 UTC. A record that drops out of its polled status set (for example is no
longer PENDING) gets `mappedStatus = "no_longer_listed"`.

Settlement, operation and portfolio statuses are mapped through
`SettlementStatusMap` (CONFIRM-SETTLEMENT-STATUS). Unmapped values are stored as
`unknown` and raise `ALR-CFG-02` once that rule is enabled.

Pending: the v1.6.0 OpenAPI file (`docs/phase1/komainu-openapi-1.6.0.json`) is
not yet in the repo. Until it is, endpoints without a known schema keep only
non-sensitive scalar fields (`TODO(CONFIRM-KOMAINU-OPENAPI)`).

## Jira and JSM

| | |
|---|---|
| Code | `src/lib/integrations/atlassian/client.ts`, sync in `src/modules/integrations/atlassian/sync.ts`, write-back in `src/modules/work-items/ticket-writeback.ts` |
| Auth | `ATLASSIAN_BASE_URL`, `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN` (service account) |
| Projects | `JiraProjectConfig` (seeded from spec §8.3, all disabled; admin enables). Issue type, transition and custom field ids are discovered at runtime |

**Writes are allowlisted** (`ATLASSIAN_ALLOWLIST`): create issue/request,
comment (internal by default), assign, transition, set labels and allowlisted
custom fields, link issues. No deletes; no project, workflow, field, scheme or
automation changes.

**Inbound sync** every 2 minutes: `project in (<enabled>) AND updated >= -5m`.
Each issue becomes (or updates) a `WorkItem`; history is kept in
`JiraIssueEvent`, idempotent on `(system, key, updated)`. Status category maps
to state: new → open, in progress → owned (if assigned) or open, done →
resolved. A WorkItem closed with a write-up in KOMmand Centre stays closed.

**Write-first:** owner and status changes call Jira first and only then update
the WorkItem; on failure a `TicketWriteError` is raised and nothing changes
locally.

## Slack

| | |
|---|---|
| Push | `POST /api/webhooks/slack` (Events API), verified with `SLACK_SIGNING_SECRET`; events are queued for the worker |
| Fallback | Channel history polled every 5 minutes |
| Registry | `SlackChannel` with `purpose` (`client`, `gx_notifications`, `vendor`, `internal_ops`, `alerts_out`) and `clientId` |

`gx_notifications` channels keep bot messages and store them raw
(`SourceRecord` kind `risk_signal_raw`) for the Risk Signal parser
(CONFIRM-RISK-SOURCE). `channel_join` and similar subtypes are always skipped.
Outbound alerts go to the `alerts_out` channel with two link buttons only:
"Open in KOMmand Centre" and "Open ticket". No interactive approve or reject.

## Microsoft 365 (Graph)

| | |
|---|---|
| Code | `src/lib/integrations/graph/client.ts`, `src/modules/integrations/graph/` |
| Auth | Client credentials: `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` |
| Permissions | Application `Mail.Read`, `ChannelMessage.Read.All`, limited to named mailboxes by an Exchange application access policy (IT) |
| Mailboxes | `GRAPH_MAILBOXES` JSON (CONFIRM-MAILBOXES) |
| Teams | `GRAPH_TEAMS_CHANNELS` JSON; internal context only |

Mail by purpose: `custody` messages become CommsThreads (as the retired IMAP
adapter did); `fab_ics` messages are stored for the FAB rules
(CONFIRM-FAB-TEMPLATES); `vendor_notifications` messages are parsed by vendor
parsers into `vendor_ticket` WorkItems linked to the matching VSR ticket. No
vendor parser is registered until redacted samples exist
(CONFIRM-VENDOR-FORMATS).

## Imports and other sources

`/admin/imports` lists the file-import sources (Chainalysis, MTD variance,
Tatum, inbound). Each template is built from a real export; until then uploads
are refused with its CONFIRM id. Notabene stays off (H11). Fireblocks and Ledger
are not connected in Phase 1. The vendor status-page poller runs only when
`module.status_pages` is on (and its hosts are in `EGRESS_EXTRA_HOSTS`).

## Tests

A global test setup (`src/__tests__/setup/no-network.ts`) fails any test that
makes an unmocked network call. Connector tests stub `fetch` and assert the
exact requests made.
