#!/bin/sh

echo "Running database migrations..."
node node_modules/prisma/build/index.js migrate deploy || echo "Warning: Migration failed, continuing startup..."

echo "Starting server..."
exec node server.js
