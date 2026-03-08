# ADR-003: Authorization Model

**Status:** Accepted
**Date:** 2026-03-08
**Decision Makers:** Platform Team

## Context

The platform manages multi-team operations across Transaction Operations, Admin Operations,
Data Operations, Staking Ops, and Settlements. Different roles need different levels of
access, and some data must be scoped to specific teams or individuals.

## Decision

### Role-Based Access Control (RBAC) with Resource-Level Scoping

Four roles with hierarchical privilege levels:

| Role | Purpose | Scope |
|------|---------|-------|
| **admin** | Full platform administration | All data, all actions |
| **lead** | Team management and operations oversight | Team-scoped data, elevated actions |
| **employee** | Day-to-day operations | Own data, basic actions |
| **auditor** | Read-only compliance oversight | All data, view only |

### Authorization Matrix

A centralized `AUTHORIZATION_MATRIX` in `src/modules/auth/types/index.ts` defines
the complete permission model as:

```
Role → Resource → { actions: Action[], scope: ScopeType }
```

- **25 resources:** employee, score, scoring_config, thread, alert, incident,
  travel_rule_case, settlement, export, audit_log, transaction_confirmation, etc.
- **15 actions:** view, view_own, view_team, create, update, delete, assign,
  reassign, acknowledge, resolve, escalate, override, export, configure, approve
- **4 scope types:** all (global), team (team members only), own (self only), none (deny)

### Scope Filtering

`applyScopeFilter()` automatically applies Prisma `where` clauses based on the
user's scope:
- `"own"` → filters to `employeeId = user.employeeId`
- `"team"` → filters to `employee.team = user.team`
- `"all"` → no additional filtering
- `"none"` → denies all results

### Field-Level Sensitivity

`SENSITIVE_FIELDS` defines which fields are masked for non-admin users:
- Employee emails
- Thread participants
- Travel rule addresses
- Wallet addresses
- Settlement wallet details
- USDC ramp bank references
- User passwords
- Session tokens and IP addresses

### Segregation of Duties

For scoring configuration governance:
- Creator cannot be the reviewer
- Reviewer cannot be the approver
- Approver cannot be the activator
- Each transition is recorded in `WorkflowEvent`

### Export Controls

- Row limits by role (admin: 50K, lead: 10K, employee: 0, auditor: 50K)
- Exportable resources restricted by role
- Every export is watermarked with exporter identity
- All exports logged to audit trail

## Alternatives Considered

1. **Attribute-Based Access Control (ABAC):** More flexible but significantly more
   complex. RBAC with scope-based filtering provides sufficient granularity for the
   current team structure.
2. **Per-route permission checks (no matrix):** Harder to audit, easier to miss checks.
   The centralized matrix makes the permission model explicit and testable.
3. **Database-stored permissions:** Would allow runtime permission changes but adds
   latency. Static matrix is faster and changes go through code review.

## Consequences

- Adding a new resource requires updating the matrix in one place.
- Adding a new role requires defining permissions for all resources.
- Scope filtering happens at the query level, so DB results are already scoped.
- The auditor role is strictly read-only — enforced at both middleware and route level.

## Related

- `src/modules/auth/types/index.ts` — Authorization matrix definition
- `src/modules/auth/services/authorization.ts` — Runtime enforcement
- `src/modules/export/services/export-service.ts` — Export governance
- `src/modules/scoring/services/scoring-service.ts` — Config governance
- `src/middleware.ts` — Middleware-level role enforcement
