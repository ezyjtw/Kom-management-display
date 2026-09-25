# Load, refresh rates and cost

Phase 12n. What runs on a schedule, what each browser tab does, and the settings that control them. Defaults are in `src/lib/job-schedules.ts`; admins change cadences with the `jobs.schedules` setting, and the worker applies a change within 5 minutes.

## Worker schedules

| Job | Default | Adjustable | Notes |
|---|---|---|---|
| `sync_slack`, `sync_mail` | every 5 min, 24/7 | **No** (standing rule, spec §6.1) | One Slack call per channel per cycle; mail uses a Graph delta cursor |
| `custody_poll_requests` | every 2 min | Yes | Was every minute. The fastest alert clock on pending requests is 10 minutes |
| `custody_poll_transactions` | every 2 min | Yes | |
| `custody_poll_collateral` | every 10 min | Yes | |
| `custody_poll_audit_logs` | every 5 min | Yes | |
| Custody daily polls | 07:00–07:45 UTC | Yes | |
| `check_confirmations` | every 5 min | Yes | Reads status from the polled records; direct API calls only for items the pollers have not seen (at most 20 per run) |
| `poll_client_ticket_comments` | every 5 min | Yes | One search for updated requests; full sweep in the first cycle of each hour |
| `graph_teams_sync` | every 5 min | Yes | Intake runs only for new or edited messages |
| `evaluate_alerts`, `poll_risk_signals` | every minute | Yes | The six SLA rules share one read per run |
| Others | see `src/lib/job-schedules.ts` | Yes | |

`check_sla` was retired: it counted breached threads every minute and nothing used the count.

Custody heartbeat expectations follow the current cadence, so a slower schedule does not raise a false "feed silent" alert.

**Worker idle loop:** checks for due jobs every 10 seconds (was 2 seconds).

**Run history:** a run whose result is `{ skipped: true }` (integration not configured, feature off) writes no `BackgroundJobRun` row. The job row keeps its last result and time. Retention runs are always recorded.

## Database writes

- **Source records:** an unchanged record gets one bulk `lastSeenAt` update per poll instead of a rewrite; only new or changed records are written.
- **Health check:** `/api/health` reads the worker state on every call but maintains the ALR-HB-WORKER alert at most once a minute per process, and at once when the state changes.
- **Push events:** no longer make a database notify call (nothing listened to it). Events reach browsers connected to the web process that emits them; pages refresh every minute for events from the worker. Running more than one web instance needs a cross-process bridge first.

## Browser

- **One push connection per tab**, shared by all components (was 2–3).
- **App-shell polls** (worker status, draft count) run every 60 s only while the tab is visible, and refresh at once when it becomes visible again.
- **Work queue:** reloads on push events at most once every 5 seconds, plus a visible-only safety refresh every minute.
- **Idle sign-out:** automatic refreshes send `x-kom-background: 1` and do not count as activity, so an open tab still reaches the 1-hour idle sign-out (spec §17.3). Previously the 60-second poll kept every open session alive.

## Settings

| Setting | Default | Effect |
|---|---|---|
| `jobs.schedules` | `{}` | Cron per job. Refused: Slack/mail, invalid cron, more than once a minute, less than once a day |
| `slack.replyLookbackDays` | 7 (1–14) | How far back each Slack poll re-reads for new replies on existing threads. Shorter = smaller responses, but replies to older threads are missed |
| `retention.enabled` | off | Turns on the retention policies in `src/lib/data-retention.ts`, including the new ones below |

## Retention (runs only when `retention.enabled` is on)

- Source records the source stopped returning 365 days ago (`lastSeenAt`).
- Jira issue events older than 180 days.
- Periods are proposals until TODO(CONFIRM-RETENTION). Audit log and job-run evidence are never deleted by retention.
