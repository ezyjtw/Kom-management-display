# Deployment Guide

## Environments

| Environment | Purpose | Database | Auth |
|-------------|---------|----------|------|
| Development | Local dev | Local PostgreSQL | Seeded users (`ALLOW_LOCAL_LOGIN=true`) |
| Staging | Pre-production testing | Staging PostgreSQL | Entra ID SSO (+ local login if enabled) |
| Production | Live ops | Production PostgreSQL | Entra ID SSO only |

The target production runtime (web + worker containers, Key Vault, private
networking, egress allowlist) is described in [`deploy/azure/README.md`](../deploy/azure/README.md).

## Environment Variables

> **Production: secrets are files, not environment variables.** Every
> secret-bearing key below (`NEXTAUTH_SECRET`, `CRON_SECRET`,
> `ENCRYPTION_SECRET`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`, `*_API_KEY`) is read
> from a file of the same name in `SECRETS_DIR` (Key Vault mounted on tmpfs). The
> app refuses to start in production if one is set as an environment variable.
> The `KEY=value` lists below are for **local development** (`.env`, no
> `SECRETS_DIR`). See `docs/phase1/credentials.md` and `deploy/azure/README.md`.

### Required
```
DATABASE_URL=postgresql://user:pass@host:5432/dbname
NEXTAUTH_SECRET=<random-32-char-string>
NEXTAUTH_URL=https://your-domain.com
```

### Single sign-on (Entra ID)
```
AZURE_AD_TENANT_ID=<tenant-id>
AZURE_AD_CLIENT_ID=<app-registration-client-id>
AZURE_AD_CLIENT_SECRET=<client-secret>
ROLE_GROUP_MAP={"<group-object-id>":"admin","<group-object-id>":"lead"}
ALLOW_LOCAL_LOGIN=            # true only for local dev; ignored in production
```

The app registration must emit the `groups` claim (security group object IDs) in
the ID token. A user is denied, and the denial audit-logged, if:
- none of their groups appears in `ROLE_GROUP_MAP`;
- Entra reports group overage (too many groups to fit in the token);
- no active `Employee` record has their email address.

If a user is in several mapped groups, the highest role wins (admin > lead > employee > auditor).
Sessions last 12 hours.

### Egress allowlist
```
ATLASSIAN_BASE_URL=https://komainu.atlassian.net   # default
EGRESS_EXTRA_HOSTS=                                 # comma-separated extra hostnames
```

All outbound HTTP goes through `src/lib/http/client.ts`, which blocks any host
not on the allowlist: the Komainu API host, the Atlassian site,
`api.atlassian.com`, `slack.com`, `graph.microsoft.com`,
`login.microsoftonline.com`, plus `EGRESS_EXTRA_HOSTS`. Switching on an optional
module that calls another host also needs that host added, for example the
market ticker (`module.market_ticker`): `api.coingecko.com,api.etherscan.io,mempool.space,open-api.coinglass.com`.
The Slack SDK makes its own HTTP calls, but only to `slack.com`.

### Optional: Integrations
```
ATLASSIAN_EMAIL=<service-account@your-org.com>
ATLASSIAN_API_TOKEN=<token>

SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=<secret>       # required for the Events API (/api/webhooks/slack)

GRAPH_TENANT_ID=<tenant-id>
GRAPH_CLIENT_ID=<app-id>
GRAPH_CLIENT_SECRET=<secret>
GRAPH_MAILBOXES=[{"label":"custody","address":"...","purpose":"custody"}]
GRAPH_TEAMS_CHANNELS=[{"label":"ops","teamId":"...","channelId":"..."}]

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=ops@your-org.com
SMTP_PASSWORD=<app-password>

KOMAINU_API_BASE_URL=https://api-demo.komainu.io
KOMAINU_API_USER=<api-user>
KOMAINU_API_SECRET=<api-secret>
# or several users: KOMAINU_API_CREDENTIALS=[{"label":"uk","user":"...","secretRef":"KOMAINU_API_SECRET_UK"}]

# Notabene is disabled (H11)
NOTABENE_API_BASE_URL=
NOTABENE_API_TOKEN=<token>
NOTABENE_VASP_DID=did:ethr:0x...

FIREBLOCKS_API_KEY=<key>
FIREBLOCKS_API_SECRET=<secret>
```

### Optional: Operational
```
CRON_SECRET=<secret-for-cron-endpoints>
LOG_LEVEL=info
AI_PROVIDER=none              # AI is off by default (H3)
ALLOW_SEED=                   # never seeds in production
GIT_COMMIT_SHA=<build-sha>
```

### Environment Variable Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Yes | Secret for signing JWT tokens (min 32 chars) |
| `NEXTAUTH_URL` | Yes | Canonical URL of the application |
| `CRON_SECRET` | No | Shared secret for cron-triggered endpoints (e.g., alert generation) |
| `LOG_LEVEL` | No | Logging verbosity: `debug`, `info`, `warn`, `error` (default: `info`) |
| `ATLASSIAN_EMAIL` / `ATLASSIAN_API_TOKEN` | No | Jira and JSM service account (with `ATLASSIAN_BASE_URL`) |
| `SLACK_*` | No | Slack bot token; signing secret verifies Events API deliveries |
| `GRAPH_*` | No | Microsoft Graph mail and Teams (read-only); replaces IMAP |
| `SMTP_*` | No | Outbound email notifications |
| `KOMAINU_API_CREDENTIALS` | No | Several read-only Komainu API users (JSON; secrets referenced by env var name) |
| `AZURE_AD_TENANT_ID` / `AZURE_AD_CLIENT_ID` / `AZURE_AD_CLIENT_SECRET` | Prod: yes | Entra ID single sign-on |
| `ROLE_GROUP_MAP` | Prod: yes | JSON map of Entra group object ID to role |
| `ALLOW_LOCAL_LOGIN` | No | `true` enables username/password login outside production only |
| `ATLASSIAN_BASE_URL` | No | Atlassian site; its host is on the egress allowlist (default `komainu.atlassian.net`) |
| `EGRESS_EXTRA_HOSTS` | No | Extra comma-separated hosts for the egress allowlist |
| `ALLOW_SEED` | No | `true` seeds on startup outside production; never seeds production |
| `GIT_COMMIT_SHA` | No | Build version shown in deep health checks |
| `KOMAINU_API_*` | No | Komainu API (read-only) |
| `NOTABENE_*` | No | Notabene travel rule integration (disabled, H11) |
| `FIREBLOCKS_*` | No | Fireblocks wallet/transaction integration |
| `AI_PROVIDER` / `*_API_KEY` | No | AI features; off unless set and flag `ai.enabled` is on (H3) |

## Docker Deployment

```bash
# Build
docker build -t kommand-centre .

# Run (production mode: secrets from a mounted directory, never -e)
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://..." \
  -e NEXTAUTH_URL="https://..." \
  -e SECRETS_DIR=/mnt/secrets \
  --mount type=tmpfs,destination=/mnt/secrets \
  kommand-centre
# (populate /mnt/secrets/NEXTAUTH_SECRET etc. from Key Vault; locally, a
#  read-only bind mount of a directory of files works for testing)
```

### Docker Compose (full stack)

```bash
# Start database, web app and worker
docker compose up -d

# View logs
docker compose logs -f app worker

# Stop
docker compose down
```

The `docker-compose.yml` provisions PostgreSQL 16 with a persistent volume and
health checks. The `app` container waits for the database and runs migrations;
the `worker` container uses the same image, starts once `app` is healthy, and
runs `npm run worker:prod`.

### Background worker

Alerts, SLA checks and integration syncs run in an always-on worker process
(`src/worker/index.ts`; `npm run worker` in development). The image bundles it
to `worker.js`, started with `npm run worker:prod`. It writes a heartbeat every
30 seconds and drains the in-flight job for up to 25 seconds on SIGTERM.

If no worker heartbeat is seen for 2 minutes, `/api/health` reports
`"worker_alive": false` and `"status": "degraded"`, the web app shows a red
banner, and alert `ALR-HB-WORKER` is raised. Point external monitoring at
`worker_alive`.

## Database Setup

```bash
# Generate Prisma client
npx prisma generate

# Push schema to database (dev only)
npx prisma db push

# Seed initial data
npx tsx prisma/seed.ts
```

## Production Deployment Checklist

### Pre-deployment
- [ ] All tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] Database migration reviewed (`npx prisma migrate diff`)
- [ ] Migration tested against staging database
- [ ] Environment variables verified (no missing required vars)
- [ ] `NEXTAUTH_SECRET` is unique per environment and at least 32 characters
- [ ] Integration credentials validated (run health check)
- [ ] Backup taken of production database

### Deployment
- [ ] Apply database migration: `npx prisma migrate deploy`
- [ ] Deploy new container image
- [ ] Verify liveness probe: `GET /api/health/liveness` returns 200
- [ ] Verify readiness probe: `GET /api/health/readiness` returns 200
- [ ] Verify full health: `GET /api/health` shows DB connected
- [ ] Verify integration health: `GET /api/integrations/health`
- [ ] Smoke test critical paths: login, dashboard load, thread list

### Post-deployment
- [ ] Monitor application logs for errors (first 15 minutes)
- [ ] Verify the worker is alive: `GET /api/health` shows `"worker_alive": true`
- [ ] Confirm audit log is recording events
- [ ] Notify team of successful deployment

## Migration Safety Protocol

1. **Never** run `prisma db push` in production -- use `prisma migrate deploy`
2. Review migration SQL before applying: `npx prisma migrate diff`
3. Test migrations against a temporary database in CI (see schema-check job)
4. Keep migration files in version control
5. Never edit existing migration files
6. For destructive schema changes (dropping columns/tables):
   - Deploy code that stops reading the column first
   - Wait for confirmation the column is unused
   - Then deploy the migration that drops it
7. For adding non-nullable columns:
   - Add as nullable first, backfill data, then add NOT NULL constraint

## Rollback Procedures

### Application Rollback
```bash
# Docker: redeploy previous image tag
docker pull kommand-centre:<previous-tag>
docker stop kommand-centre
docker run -d --name kommand-centre -p 3000:3000 \
  --env-file .env kommand-centre:<previous-tag>
```

### Database Rollback
```bash
# Restore from latest backup
pg_restore -h <host> -U <user> -d kommand < backup.sql

# If using Prisma migrations, revert specific migration:
# 1. Create a new down migration manually
# 2. Apply it with: npx prisma migrate deploy
```

### Scoring Config Rollback
Scoring configuration has built-in versioning. Previous versions are preserved and can be reactivated via the admin panel without a deployment.

## Rollback Plan

1. Database: Restore from latest backup
2. Application: Redeploy previous Docker image
3. Config: Revert scoring config via admin panel (historical versions preserved)

## Backup Strategy

- Database: Automated daily backups via cloud provider
- Retention: 30 days for daily backups, 1 year for monthly
- Test restores: Monthly verification
- RPO: 24 hours (daily backup)
- RTO: 1 hour (restore + redeploy)

## Health Check Endpoints

| Endpoint | Auth | Purpose | Success | Failure |
|----------|------|---------|---------|---------|
| `GET /api/health/liveness` | No | Is the process running? | 200 | 503 |
| `GET /api/health/readiness` | No | Can it serve traffic? (DB + env + integrations) | 200 | 503 |
| `GET /api/health` | No | Detailed status (DB latency, version, uptime) | 200 | 503 |

### Docker Compose Health Check
The app container is configured with:
- Check: `wget http://localhost:3000/api/health`
- Interval: 30s
- Timeout: 10s
- Retries: 3
- Start period: 30s (grace period for startup)

### Load Balancer
Point the health check to `/api/health/readiness`. This endpoint validates:
- Database connectivity (Prisma query)
- Required environment variables present
- Integration adapters reachable (non-blocking)

## Monitoring Setup

### Structured Logging
All application logs are output as structured JSON via `src/lib/logger.ts`. Fields include:
- `level`: info, warn, error
- `message`: Human-readable description
- `requestId`: Correlation ID for tracing
- `module`: Source module (scoring, comms, auth, etc.)
- `duration`: Request duration in ms (for API routes)
- `userId`: Authenticated user (when available)

### Key Metrics to Monitor

| Metric | Source | Alert Threshold |
|--------|--------|----------------|
| API response time (p95) | Health endpoint / logs | > 2 seconds |
| Error rate (5xx) | Application logs | > 1% of requests |
| Database latency | `/api/health` response | > 100ms |
| Integration health | `/api/integrations/health` | Any adapter "down" |
| Failed login attempts | Audit logs | > 20 per hour |
| Job queue backlog | Integration health | > 100 pending jobs |
| Disk usage (DB volume) | Infrastructure metrics | > 80% |

### Log Aggregation
Feed structured JSON logs into your preferred log aggregation service (Datadog, Grafana Loki, CloudWatch). Use `requestId` to correlate multi-step operations.
