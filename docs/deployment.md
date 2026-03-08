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

## Database Setup

```bash
# Generate Prisma client
npx prisma generate

# Push schema to database (dev only)
npx prisma db push

# Seed initial data
npx tsx prisma/seed.ts
```

## Migration Safety

1. **Never** run `prisma db push` in production — use migrations
2. Review migration SQL before applying: `npx prisma migrate diff`
3. Test migrations against a temporary database in CI (see schema-check job)
4. Keep migration files in version control
5. Never edit existing migration files

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

## Health Monitoring

- Liveness: `GET /api/health/liveness` — returns 200 if app is running
- Readiness: `GET /api/health/readiness` — returns 200 if DB + env are ready
- Health: `GET /api/health` — returns DB latency + version info
