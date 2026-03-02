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

echo "Running database migrations..."
node node_modules/prisma/build/index.js migrate deploy || echo "Warning: Migration failed, continuing startup..."

echo "Seeding database (idempotent — safe to re-run)..."
node prisma/seed.js || echo "Warning: Seed failed, continuing startup..."

# Auto-set NEXTAUTH_URL from Railway domain if not explicitly configured
if [ -z "$NEXTAUTH_URL" ] && [ -n "$RAILWAY_PUBLIC_DOMAIN" ]; then
  export NEXTAUTH_URL="https://${RAILWAY_PUBLIC_DOMAIN}"
  echo "Auto-set NEXTAUTH_URL=${NEXTAUTH_URL}"
fi

echo "Starting server..."
exec node server.js
