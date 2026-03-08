# Architecture Decision Records

## ADR-001: Application Framework

**Decision**: Next.js 14 (App Router) with TypeScript

**Context**: Need a full-stack framework that keeps frontend, backend, and auth in one deployable unit for a solo-to-small-team internal operations platform.

**Rationale**: App Router provides file-based routing, API routes, server components, and middleware in one package. TypeScript enforces type safety across the full stack. Avoids maintaining separate frontend and backend services.

**Trade-offs**: Tightly couples UI and API. Acceptable for an internal tool; would revisit for a multi-team or public-facing product.

---

## ADR-002: Authentication Strategy

**Decision**: NextAuth.js with Credentials provider, JWT sessions, role-based access control

**Context**: Internal ops tool with three roles (Admin, Lead, Employee). No external identity provider required initially.

**Rationale**:
- JWT sessions avoid per-request database lookups for auth
- Role and team encoded in JWT token for fast access control decisions
- 24-hour session expiry balances security with usability
- Centralized middleware protects all routes before handlers execute
- `requireAuth()` and `requireRole()` guards enforce API-level access

**Single auth path**: All authentication flows through NextAuth. Legacy cookie-based auth helper has been removed.

**Future considerations**: MFA for privileged users, session revocation, IdP integration (Okta/Azure AD).

---

## ADR-003: Database and Persistence

**Decision**: PostgreSQL via Prisma ORM, migration-based schema management

**Context**: Production runs on Railway PostgreSQL. Local development uses PostgreSQL (via Docker or native install).

**Rationale**:
- PostgreSQL for production-grade reliability, JSON support, and full-text search capability
- Prisma provides type-safe queries, migration management, and schema versioning
- `prisma migrate deploy` runs on every container start via `start.sh`
- Single database dialect across all environments (no SQLite/Postgres drift)

**Migration discipline**: All schema changes require a migration file. `db push` is not used in production.

---

## ADR-004: Ingestion Model

**Decision**: Integration adapters in `src/lib/integrations/` with server-side API routes

**Context**: External systems (Slack, Email/IMAP, Jira, Komainu, Notabene) need to be synced into the internal data model.

**Current architecture**:
- Each integration has a dedicated adapter module (`slack.ts`, `email.ts`, `jira.ts`, `komainu.ts`, `notabene.ts`)
- Adapters handle authentication, data fetching, and normalization
- API routes in `src/app/api/integrations/` expose sync triggers
- Data is normalized into internal models (CommsThread, TravelRuleCase, etc.)

**Design principle**: External data is always normalized into internal models before use. No API route directly queries external systems for display — all external data is ingested and stored locally first.

**Future consideration**: Background job workers (BullMQ or similar) for scheduled ingestion, retry queues, and dead-letter handling. Currently syncs are request-triggered.

---

## ADR-005: Audit Model

**Decision**: Append-only AuditLog table with JSON details

**Context**: Institutional ops platform requires full traceability of who did what and when.

**What is logged**:
- Login success/failure
- Employee creation/update
- Score updates (with old/new values)
- Thread ownership changes
- Thread status changes
- Travel rule case lifecycle events
- Incident creation/updates/resolution
- Screening reclassifications
- Approval actions
- Data exports
- Config changes
- Integration syncs

**Rationale**: Single audit table with flexible JSON `details` field allows consistent querying while accommodating different action types. All audit writes are fire-and-forget (never block the primary operation).

---

## ADR-006: Background Jobs

**Decision**: Currently request-triggered; planned migration to worker-based processing

**Context**: Alert generation, integration syncs, and SLA monitoring need periodic execution.

**Current state**:
- Alert generation exposed as a CRON-protected endpoint (`/api/alerts/generate`)
- Integration syncs triggered via API calls
- Market data cached with 60s ISR revalidation

**Planned**: Introduce a job queue (BullMQ + Redis or pg-boss) for:
- Scheduled integration syncs (Slack, Email, Jira polling)
- SLA deadline monitoring and alert generation
- Staking reward heartbeat checks
- External ticket status polling
- Failed sync retries with exponential backoff

---

## ADR-007: Tenancy and Access Boundaries

**Decision**: Team-based data scoping with role-based elevation

**Access model**:
- **Employee**: Sees own threads, own scores, own team's unassigned queue
- **Lead**: Sees their team's threads, scores, and activity
- **Admin**: Unrestricted access to all data

**Implementation**: `session.user.team` is encoded in JWT. API routes use this for query scoping. Middleware enforces route-level protection; API handlers enforce data-level scoping.

**Future consideration**: Region/legal entity scoping for multi-jurisdiction deployments.
