# Architecture Overview

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
│  modules/integrations/adapters/komainu-adapter.ts        │
│  modules/integrations/adapters/notabene-adapter.ts       │
├─────────────────────────────────────────────────────────┤
│                   Infrastructure                          │
│  Prisma ORM → PostgreSQL                                 │
│  Job Queue (in-memory, Redis-ready)                      │
│  Logger (structured JSON)                                │
│  Rate Limiter                                            │
└─────────────────────────────────────────────────────────┘
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

## Auth Flow

```
Request → Middleware (JWT check) → Route Handler → requireAuth()
  → checkAuthorization(user, resource, action) → applyScopeFilter()
  → Service Layer → Repository → Prisma → PostgreSQL
```

## Integration Flow

```
External System → Adapter.sync() → NormalizedEvent[]
  → Job Queue → Worker → Service Layer → Database
  → Alert Generation (if thresholds breached)
```

## Data Flow

```
Inbound Data (Jira/Slack/Email/Fireblocks/Komainu/Notabene)
  ↓
Integration Adapter (normalize + deduplicate)
  ↓
Job Queue (retry + dead-letter)
  ↓
Domain Service (business logic)
  ↓
Repository (data access)
  ↓
PostgreSQL (persistence)
  ↓
Audit Log (every mutation)
```
