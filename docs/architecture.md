# Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Client Browser                              │
│  Next.js SSR Pages + React Client Components                        │
│  Dashboard │ Thread Detail │ Admin │ Travel Rule │ Command Centre   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTPS (JWT cookie)
┌──────────────────────────────▼──────────────────────────────────────┐
│                      Next.js API Routes                             │
│  /api/scores │ /api/comms │ /api/export │ /api/travel-rule │ ...    │
│                                                                     │
│  Request → Middleware (JWT) → Route Handler → requireAuth()         │
│    → checkAuthorization(user, resource, action) → applyScopeFilter()│
│    → Service Layer → Repository → Prisma → PostgreSQL               │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
      ┌────────────────────────┼────────────────────────┐
      ▼                        ▼                        ▼
┌───────────┐          ┌──────────────┐         ┌──────────────┐
│  Domain   │          │  Repository  │         │  Integration │
│  Services │          │  Layer       │         │  Adapters    │
│           │          │              │         │              │
│ scoring   │──────────▶ score-repo   │         │ slack        │
│ thread    │          │ thread-repo  │         │ email/IMAP   │
│ alert     │          │ employee-repo│         │ jira         │
│ employee  │          │              │         │ fireblocks   │
│ travel    │          └──────┬───────┘         │ custody      │
│ incident  │                 │                 │ notabene     │
│ export    │                 ▼                 └──────┬───────┘
└───────────┘          ┌──────────────┐                │
                       │  Prisma ORM  │                │
                       └──────┬───────┘         NormalizedEvent[]
                              │                        │
                              ▼                        ▼
                       ┌──────────────┐         ┌──────────────┐
                       │ PostgreSQL   │         │  Job Queue   │
                       │              │◀────────│  (async      │
                       │ + Audit Log  │         │   workers)   │
                       └──────────────┘         └──────────────┘
```

## Layers

```
┌─────────────────────────────────────────────────────────┐
│                   Presentation Layer                     │
│  Next.js Pages (SSR + Client Components)                │
│  Dashboard, Thread Detail, Admin, Travel Rule, etc.     │
├─────────────────────────────────────────────────────────┤
│                   Route / Controller Layer               │
│  API Routes: /api/scores, /api/comms, /api/export, etc. │
│  Thin handlers: validate → authorize → call service →   │
│  return response                                         │
├─────────────────────────────────────────────────────────┤
│                   Domain / Service Layer                  │
│  modules/scoring/services/scoring-service.ts             │
│  modules/comms/services/thread-service.ts                │
│  modules/alerts/services/alert-service.ts                │
│  modules/employees/services/employee-service.ts          │
│  modules/travel-rule/services/travel-rule-service.ts     │
│  modules/incidents/services/incident-service.ts          │
│  modules/export/services/export-service.ts               │
├─────────────────────────────────────────────────────────┤
│                   Repository / Data Access Layer          │
│  modules/scoring/repositories/score-repository.ts        │
│  modules/comms/repositories/thread-repository.ts         │
│  modules/employees/repositories/employee-repository.ts   │
├─────────────────────────────────────────────────────────┤
│                   Integration Adapter Layer               │
│  modules/integrations/adapters/jira-adapter.ts           │
│  modules/integrations/adapters/slack-adapter.ts          │
│  modules/integrations/adapters/email-adapter.ts          │
│  modules/integrations/adapters/fireblocks-adapter.ts     │
│  modules/integrations/adapters/custody-adapter.ts        │
│  modules/integrations/adapters/notabene-adapter.ts       │
├─────────────────────────────────────────────────────────┤
│                   Infrastructure                          │
│  Prisma ORM → PostgreSQL                                 │
│  Job Queue (in-memory, Redis-ready)                      │
│  Logger (structured JSON)                                │
│  Rate Limiter                                            │
└─────────────────────────────────────────────────────────┘
```

## Module Dependency Diagram

```
                    ┌──────────┐
                    │   auth   │ (RBAC matrix, scope filtering)
                    └────┬─────┘
                         │ used by all modules
        ┌────────────────┼────────────────────────┐
        ▼                ▼                        ▼
   ┌─────────┐    ┌───────────┐           ┌──────────────┐
   │ scoring │    │   comms   │           │ travel-rule  │
   │         │    │           │           │              │
   │ config  │    │ threads   │           │ cases        │
   │ scores  │    │ notes     │           │ reconcile    │
   │ periods │    │ ownership │           │ compliance   │
   └────┬────┘    │ SLA       │           └──────────────┘
        │         └─────┬─────┘
        │               │ triggers
        │               ▼
        │         ┌───────────┐     ┌──────────────┐
        │         │  alerts   │     │  incidents   │
        │         │           │     │              │
        │         │ generate  │     │ tracking     │
        │         │ route     │     │ RCA          │
        │         │ lifecycle │     └──────────────┘
        │         └───────────┘
        │
        ▼
   ┌─────────┐    ┌───────────┐     ┌──────────────┐
   │employees│    │  export   │     │    jobs       │
   │         │    │           │     │              │
   │ CRUD    │    │ governed  │     │ async queue  │
   │ teams   │    │ CSV/JSON  │     │ retry/DLQ    │
   └─────────┘    └───────────┘     └──────┬───────┘
                                           │
                                    ┌──────▼───────┐
                                    │ integrations │
                                    │              │
                                    │ adapters     │
                                    │ registry     │
                                    │ health       │
                                    └──────────────┘
```

## Module Boundaries

Each operational domain has its own module under `src/modules/`:

| Module | Purpose | Key Models |
|--------|---------|------------|
| `auth` | Authorization matrix, RBAC, scope filtering | User, Role |
| `scoring` | Performance scoring engine, config management | CategoryScore, ScoringConfig |
| `comms` | Thread management, ownership, SLA tracking | CommsThread, OwnershipChange |
| `alerts` | Alert generation, routing, lifecycle | Alert |
| `employees` | Employee CRUD, team management | Employee |
| `travel-rule` | Case lifecycle, reconciliation | TravelRuleCase |
| `incidents` | 3rd-party incident tracking, RCA | Incident |
| `integrations` | Adapter pattern for external systems | NormalizedEvent |
| `jobs` | Async processing queue | Job |
| `export` | Governed data export | - |

## Data Flow

```
Client Request
  │
  ▼
Middleware (JWT validation, rate limiting)
  │
  ▼
Route Handler (parse params, validate input)
  │
  ▼
requireAuth() → checkAuthorization(user, resource, action)
  │
  ▼
applyScopeFilter(query, user.scope)   ← restricts data to all/team/own
  │
  ▼
Service Layer (business logic, validation, orchestration)
  │
  ▼
Repository (data access patterns, query building)
  │
  ▼
Prisma Client (type-safe ORM)
  │
  ▼
PostgreSQL (persistence + audit log triggers)
```

## Integration Flow

```
External System (Jira / Slack / Email / Fireblocks / Custody / Notabene)
  │
  ▼
Adapter.sync()  ─── verifyWebhookSignature() (for push-based integrations)
  │
  ▼
NormalizedEvent[] (sourceSystem, sourceId, entityType, eventType, payload)
  │
  ▼
Deduplication (by sourceSystem + sourceId)
  │
  ▼
Job Queue (enqueue for async processing, with retry + dead-letter)
  │
  ▼
Worker (persist to DB via service layer)
  │
  ▼
Alert Generation (if SLA thresholds breached)
```

## Deployment Architecture

```
┌─────────────────────────────────────────────────┐
│                   Docker Host / Railway           │
│                                                   │
│  ┌─────────────────────────────────────────────┐ │
│  │         App Container (node:20-alpine)      │ │
│  │                                             │ │
│  │  Next.js Standalone Server (port 3000)      │ │
│  │  ├─ SSR Pages                               │ │
│  │  ├─ API Routes                              │ │
│  │  ├─ Prisma Client                           │ │
│  │  └─ start.sh (migrations + seed + server)   │ │
│  │                                             │ │
│  │  Health checks:                             │ │
│  │  ├─ /api/health/liveness  (app running)     │ │
│  │  ├─ /api/health/readiness (DB + env ready)  │ │
│  │  └─ /api/health           (full status)     │ │
│  └──────────────────┬──────────────────────────┘ │
│                     │                             │
│  ┌──────────────────▼──────────────────────────┐ │
│  │         DB Container (postgres:16)          │ │
│  │                                             │ │
│  │  Database: kommand                          │ │
│  │  Volume: pg-data (persistent)               │ │
│  │  Health: pg_isready                         │ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

### Docker Build Stages

| Stage | Base Image | Purpose |
|-------|-----------|---------|
| `deps` | node:20-alpine | Install npm dependencies |
| `builder` | node:20-alpine | Generate Prisma client, build Next.js, compile seed |
| `runner` | node:20-alpine | Minimal production image with standalone output |

The production image runs as a non-root `nextjs` user (UID 1001) and exposes port 3000.

### Railway Deployment

Railway auto-detects the Dockerfile. Required environment variables are set via the Railway dashboard. The PostgreSQL database is provisioned as a Railway service with `DATABASE_URL` injected automatically.
