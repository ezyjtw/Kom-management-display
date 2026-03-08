# ADR-002: Prisma + PostgreSQL for Persistence

## Status
Accepted

## Context
The platform tracks employees, scores, threads, alerts, travel rule cases, incidents, and audit logs. We need:
- Type-safe ORM with auto-generated client
- Relational integrity for cross-entity references
- Migration support
- JSON column support for flexible metadata

## Decision
Use **Prisma ORM** with **PostgreSQL** as the persistence layer.

## Consequences
- **Positive**: Type-safe queries, schema-driven migrations, strong ecosystem, JSON/JSONB support
- **Negative**: Prisma generates large client bundles, some complex queries need raw SQL, migration tooling requires careful sequencing in CI
- **Mitigation**: Use repository pattern to isolate DB access, keeping Prisma imports out of route handlers and business logic. Use raw queries for complex aggregations.
