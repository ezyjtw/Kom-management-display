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

# Run migrations unless explicitly skipped (e.g. SKIP_MIGRATIONS=true)
if [ "${NODE_ENV}" = "production" ] && [ "${SKIP_MIGRATIONS}" != "true" ]; then
  echo "Running database migrations (production — fail-fast)..."

  # Auto-resolve previously failed migrations (P3009).
  # Our migrations use idempotent SQL (IF NOT EXISTS, DO $$ EXCEPTION blocks),
  # so marking them as rolled-back and re-running is safe.
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

# Only seed in non-production or when explicitly requested (ALLOW_SEED=true)
if [ "${NODE_ENV}" != "production" ] || [ "${ALLOW_SEED}" = "true" ]; then
  echo "Seeding database (idempotent — safe to re-run)..."
  if node prisma/seed.js 2>&1; then
    echo "Seed completed successfully."
  else
    SEED_EXIT=$?
    echo "WARNING: Seed script failed with exit code $SEED_EXIT. Check logs above for details."
    echo "You can re-run seeding from the Admin Panel (Employees tab) or via POST /api/admin/seed."
  fi
else
  echo "Skipping seed in production (set ALLOW_SEED=true to override)"
fi

# Auto-set NEXTAUTH_URL from Railway domain if not explicitly configured
if [ -z "$NEXTAUTH_URL" ] && [ -n "$RAILWAY_PUBLIC_DOMAIN" ]; then
  export NEXTAUTH_URL="https://${RAILWAY_PUBLIC_DOMAIN}"
  echo "Auto-set NEXTAUTH_URL=${NEXTAUTH_URL}"
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
