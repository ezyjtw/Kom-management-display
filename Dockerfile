# Base image pinned by digest (spec §17.6): node:22-alpine (Node 22 LTS; Node 20
# reached end of life in April 2026). Dependabot proposes digest updates.
ARG NODE_IMAGE=node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

# Stage 1: Dependencies
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Build
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

# Prisma engines need OpenSSL during next build (page data collection)
RUN apk add --no-cache openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Ensure public directory exists (needed for COPY in runner stage)
RUN mkdir -p public

# Generate Prisma client
RUN npx prisma generate

# Compile seed script to JS so it can run without tsx in production
RUN npx esbuild prisma/seed.ts --bundle --platform=node --outfile=prisma/seed.js --external:@prisma/client --external:bcryptjs

# Bundle the always-on worker (same image, run as a second container)
RUN npx esbuild src/worker/index.ts --bundle --platform=node --target=node20 --outfile=dist/worker.js --external:@prisma/client --external:.prisma

# Build Next.js
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Stage 3: Production
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Prisma engines need OpenSSL at runtime on Alpine
RUN apk add --no-cache openssl

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built assets
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy Prisma schema + migrations for runtime migration
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

# Copy seed script dependencies
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs
COPY --from=builder /app/package.json ./package.json

# Worker bundle (docker-compose `worker` service runs `node worker.js` with KOM_WORKLOAD=worker)
COPY --from=builder /app/dist/worker.js ./worker.js

# Copy the startup script
COPY --from=builder /app/start.sh ./start.sh

RUN chown -R nextjs:nodejs /app

# No package manager at runtime: the web server, the worker and migrations all run
# with `node` directly (start.sh, `node worker.js`). Removing npm, npx, corepack and
# yarn drops the vulnerable copies bundled with the base image from the shipped image
# (image scan, Phase 12h) and shrinks the attack surface.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["sh", "start.sh"]
