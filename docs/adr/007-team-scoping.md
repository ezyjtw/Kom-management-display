# ADR-004: Team-Based Access Scoping

## Status
Accepted

## Context
The platform serves multiple operational teams (Transaction Operations, Admin Operations, Data Operations). Access needs to be scoped so:
- Admins see everything
- Leads see their team's data
- Employees see their own data
- Auditors see everything (read-only)

## Decision
Implement **RBAC with team/scope-based authorization** via a centralized authorization matrix.

## Model
- Role: admin | lead | employee | auditor
- Scope: all | team | own | none
- Each (role, resource, action) tuple maps to a scope
- Authorization checks happen in route handlers via `checkAuthorization()`
- Scope filtering applied to Prisma queries via `applyScopeFilter()`

## Authorization Matrix Location
`src/modules/auth/types/index.ts` — single source of truth.

## Consequences
- **Positive**: Consistent enforcement, testable matrix, clear separation of concerns
- **Negative**: Requires discipline to always call authorization checks in new routes
- **Mitigation**: CI lint rule to warn on route handlers without authorization calls (planned)
