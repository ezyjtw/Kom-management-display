#!/bin/sh

echo "Starting Container"

# Wait for database to be reachable before running migrations
echo "Waiting for database to be ready..."
MAX_RETRIES=15
RETRY_COUNT=0
until node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\$connect().then(() => { p.\$disconnect(); process.exit(0); }).catch(() => process.exit(1));
" 2>/dev/null; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ "$RETRY_COUNT" -ge "$MAX_RETRIES" ]; then
    echo "Warning: Database not reachable after $MAX_RETRIES attempts, continuing startup..."
    break
  fi
  echo "Database not ready yet (attempt $RETRY_COUNT/$MAX_RETRIES), retrying in 2s..."
  sleep 2
done

# Deployment tier (src/lib/deployment-tier.ts): a production build is the
# production tier unless KOM_ENVIRONMENT=demo names the demo tier explicitly,
# or it runs on Railway with KOM_ENVIRONMENT unset (the Railway service is the
# demo unless named otherwise). Railway may host production:
# KOM_ENVIRONMENT=production always wins (docs/phase1/go-live.md).
ON_RAILWAY="false"
if [ -n "${RAILWAY_PROJECT_ID}" ] || [ -n "${RAILWAY_ENVIRONMENT_NAME}" ] || [ -n "${RAILWAY_SERVICE_ID}" ]; then
  ON_RAILWAY="true"
fi
TIER="development"
if [ "${KOM_ENVIRONMENT}" = "demo" ]; then
  TIER="demo"
elif [ "${KOM_ENVIRONMENT}" = "production" ]; then
  TIER="production"
elif [ "${ON_RAILWAY}" = "true" ]; then
  TIER="demo"
elif [ "${NODE_ENV}" = "production" ]; then
  TIER="production"
fi
echo "Deployment tier: ${TIER}$( [ "${ON_RAILWAY}" = "true" ] && [ -z "${KOM_ENVIRONMENT}" ] && echo " (Railway detected, KOM_ENVIRONMENT unset)")"

# Demo tier only: a demo database built before the Phase 12l baseline is rebuilt
# and reseeded with the same synthetic data (prisma/demo-legacy-reset.cjs).
FORCE_SEED="false"
if [ "${TIER}" = "demo" ] && [ "${SKIP_MIGRATIONS}" != "true" ]; then
  node prisma/demo-legacy-reset.cjs
  RESET_CODE=$?
  if [ "${RESET_CODE}" = "10" ]; then
    FORCE_SEED="true"
  elif [ "${RESET_CODE}" != "0" ]; then
    echo "Aborting startup."
    exit 1
  fi
fi

# Run migrations unless explicitly skipped (e.g. SKIP_MIGRATIONS=true)
if [ "${NODE_ENV}" = "production" ] && [ "${SKIP_MIGRATIONS}" != "true" ]; then  # production builds (production and demo tiers): fail fast
  echo "Running database migrations (production — fail-fast)..."

  # Auto-resolve previously failed migrations (P3009).
  # The baseline runs in one transaction and later migrations are idempotent
  # or transactional, so marking them rolled back and re-running is safe.
  FAILED_MIGRATIONS=$(node -e "
    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient();
    p.\$queryRaw\`SELECT migration_name FROM _prisma_migrations WHERE rolled_back_at IS NULL AND finished_at IS NULL AND logs IS NOT NULL\`
      .then(rows => { rows.forEach(r => console.log(r.migration_name)); p.\$disconnect(); })
      .catch(() => p.\$disconnect());
  " 2>/dev/null)

  if [ -n "$FAILED_MIGRATIONS" ]; then
    echo "Found failed migrations, resolving..."
    for migration in $FAILED_MIGRATIONS; do
      echo "  Marking '$migration' as rolled back..."
      node node_modules/prisma/build/index.js migrate resolve --rolled-back "$migration" 2>&1 || true
    done
  fi

  node node_modules/prisma/build/index.js migrate deploy || {
    echo "FATAL: Migration failed in production. Aborting startup."
    exit 1
  }
elif [ "${SKIP_MIGRATIONS}" != "true" ]; then
  echo "Running database migrations..."
  node node_modules/prisma/build/index.js migrate deploy || echo "Warning: Migration failed, continuing startup..."
else
  echo "Skipping migrations (SKIP_MIGRATIONS=true)"
fi


if [ "${TIER}" = "production" ]; then
  # Never seed production, and never go live on a database that holds demo data:
  # going live means a fresh database (docs/phase1/go-live.md).
  echo "Skipping seed (never seeds in production)"
  DEMO_MARKER=$(node -e "
    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient();
    p.appSetting.findUnique({ where: { key: 'system.dataOrigin' } })
      .then(r => { if (r) console.log('present'); return p.\$disconnect(); })
      .catch(e => { console.log('error:' + e.message); return p.\$disconnect(); });
  " 2>/dev/null)
  if [ "${DEMO_MARKER}" = "present" ]; then
    echo "FATAL: this database holds demo (seeded) data and the tier is production."
    echo "Go live on a fresh database; see docs/phase1/go-live.md. Aborting startup."
    exit 1
  fi
  case "${DEMO_MARKER}" in
    error:*) echo "FATAL: could not check the database for demo data (${DEMO_MARKER#error:}). Aborting startup."; exit 1 ;;
  esac
elif [ "${ALLOW_SEED}" = "true" ] || [ "${FORCE_SEED}" = "true" ]; then
  echo "Seeding database with synthetic demo data (idempotent - safe to re-run)..."
  if node prisma/seed.js 2>&1; then
    echo "Seed completed successfully."
  else
    echo "WARNING: Seed script failed. Check logs above for details."
  fi
else
  echo "Skipping seed (set ALLOW_SEED=true in the demo or development tier to seed)"
fi

# Normalize NEXTAUTH_URL: prepend https:// if set but missing a protocol
case "$NEXTAUTH_URL" in
  http://*|https://*) ;;  # already has protocol
  ?*)
    export NEXTAUTH_URL="https://${NEXTAUTH_URL}"
    echo "Normalized NEXTAUTH_URL=${NEXTAUTH_URL}"
    ;;
esac

echo "Starting server..."
exec node server.js
