# Deployment Guide

## Environments

| Environment | Purpose | Database | Auth |
|-------------|---------|----------|------|
| Development | Local dev | Local PostgreSQL | Seeded users |
| Staging | Pre-production testing | Staging PostgreSQL | Seeded + test users |
| Production | Live ops | Production PostgreSQL | Real credentials |

## Environment Variables

### Required
```
DATABASE_URL=postgresql://user:pass@host:5432/dbname
NEXTAUTH_SECRET=<random-32-char-string>
NEXTAUTH_URL=https://your-domain.com
```

### Optional: Integrations
```
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=bot@your-org.com
JIRA_API_TOKEN=<token>

SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=<secret>

IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=ops@your-org.com
IMAP_PASSWORD=<app-password>

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=ops@your-org.com
SMTP_PASSWORD=<app-password>

KOMAINU_API_KEY=<key>
KOMAINU_API_URL=https://api.komainu.com

NOTABENE_API_KEY=<key>
NOTABENE_VASP_DID=did:ethr:0x...

FIREBLOCKS_API_KEY=<key>
FIREBLOCKS_API_SECRET=<secret>
```

### Optional: Operational
```
CRON_SECRET=<secret-for-cron-endpoints>
LOG_LEVEL=info
ANTHROPIC_API_KEY=<for-ai-assist>
```

### Environment Variable Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Yes | Secret for signing JWT tokens (min 32 chars) |
| `NEXTAUTH_URL` | Yes | Canonical URL of the application |
| `CRON_SECRET` | No | Shared secret for cron-triggered endpoints (e.g., alert generation) |
| `LOG_LEVEL` | No | Logging verbosity: `debug`, `info`, `warn`, `error` (default: `info`) |
| `JIRA_*` | No | Jira Cloud integration credentials |
| `SLACK_*` | No | Slack bot token and signing secret for webhook verification |
| `IMAP_*` / `SMTP_*` | No | Email integration (IMAP for inbound, SMTP for outbound) |
| `KOMAINU_*` | No | Komainu custody API integration |
| `NOTABENE_*` | No | Notabene travel rule integration |
| `FIREBLOCKS_*` | No | Fireblocks wallet/transaction integration |
| `ANTHROPIC_API_KEY` | No | AI assistant features |

## Docker Deployment

```bash
# Build
docker build -t kommand-centre .

# Run
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://..." \
  -e NEXTAUTH_SECRET="..." \
  -e NEXTAUTH_URL="https://..." \
  kommand-centre
```

### Docker Compose (full stack)

```bash
# Start app + database
docker compose up -d

# View logs
docker compose logs -f app

# Stop
docker compose down
```

The `docker-compose.yml` provisions PostgreSQL 16 with a persistent volume and health checks. The app container waits for the database to be ready before starting.

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
- [ ] Verify cron jobs are running (alert generation)
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
# Railway: revert to previous deployment
railway rollback

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

### Railway / Load Balancer
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
