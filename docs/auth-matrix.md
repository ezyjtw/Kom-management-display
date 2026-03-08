# Authorization Matrix

> Source of truth: `src/modules/auth/types/index.ts`

## Role Definitions

| Role | Description | Typical User |
|------|-------------|--------------|
| `admin` | Full platform access. Can manage users, configure scoring, override scores, manage all resources. | Platform administrators, CTO |
| `lead` | Team-scoped management. Can manage their team's employees, scores, threads, and cases. Read-only for cross-team resources. | Team leads, department heads |
| `employee` | Self-scoped access. Can view own scores, manage own threads and cases. Read-only for shared resources. | Individual contributors |
| `auditor` | Read-only access across all data. Can export data for compliance review. Cannot create, update, or delete anything. | Compliance officers, external auditors |

## Scope Definitions

| Scope | Meaning | Query Filter Applied |
|-------|---------|---------------------|
| `all` | Access to all records regardless of team or owner | No filter |
| `team` | Access restricted to records belonging to the user's team | `WHERE teamId = user.teamId` |
| `own` | Access restricted to records owned by or assigned to the user | `WHERE ownerId = user.id` or `assigneeId = user.id` |
| `none` | No access to this resource | Request rejected with 403 |

## Permission Matrix

### Core Operations Resources

| Resource | Admin | Lead | Employee | Auditor |
|----------|-------|------|----------|---------|
| **employee** | view, create, update, delete (all) | view, update (team) | view_own (own) | view (all) |
| **score** | view, create, update, override (all) | view, create, update (team) | view_own (own) | view (all) |
| **scoring_config** | view, create, update, configure, approve (all) | view (all) | view (all) | view (all) |
| **thread** | view, create, update, assign, reassign, resolve (all) | view, create, update, assign, reassign, resolve (team) | view, update, resolve (own) | view (all) |
| **thread_note** | view, create (all) | view, create (team) | view, create (own) | view (all) |
| **alert** | view, update, resolve (all) | view, update, resolve (team) | view (own) | view (all) |
| **project** | view, create, update, delete (all) | view, create, update (team) | view (team) | view (all) |
| **incident** | view, create, update, resolve (all) | view, create, update, resolve (all) | view, create (all) | view (all) |

### Compliance & Financial Resources

| Resource | Admin | Lead | Employee | Auditor |
|----------|-------|------|----------|---------|
| **travel_rule_case** | view, create, update, resolve, assign (all) | view, create, update, resolve, assign (team) | view, update (own) | view (all) |
| **daily_check** | view, create, update (all) | view, create, update (team) | view, update (own) | view (all) |
| **staking_wallet** | view, create, update (all) | view, update (all) | view (all) | view (all) |
| **settlement** | view, create, update, approve (all) | view, update, approve (all) | view (all) | view (all) |
| **screening** | view, create, update (all) | view, update (all) | view (all) | view (all) |
| **usdc_ramp** | view, create, update, approve (all) | view, update, approve (all) | view (all) | view (all) |
| **token_review** | view, create, update, approve (all) | view, update (all) | view (all) | view (all) |

### Platform Resources

| Resource | Admin | Lead | Employee | Auditor |
|----------|-------|------|----------|---------|
| **export** | view, export (all) | view, export (team) | none | view, export (all) |
| **audit_log** | view (all) | view (team) | none | view (all) |
| **user** | view, create, update, delete (all) | view (team) | none | view (all) |
| **branding** | view, update (all) | view (all) | view (all) | view (all) |

## Sensitive Field Masking

Non-admin roles receive masked values for sensitive fields. The following fields are redacted based on role:

| Resource | Masked Fields |
|----------|---------------|
| `thread` | `participants` |
| `travel_rule_case` | `senderAddress`, `receiverAddress`, `emailSentTo` |
| `staking_wallet` | `walletAddress` |
| `settlement` | `collateralWallet`, `custodyWallet` |
| `usdc_ramp` | `bankReference`, `ssiDetails`, `custodyWalletId`, `holdingWalletId` |
| `user` | `password` |

Masked fields are replaced with `"***"` in API responses for non-admin users.

## Session Security

- **Authentication**: NextAuth with JWT strategy and CredentialsProvider
- **Token contents**: `id`, `role`, `team`, `employeeId` (minimal claims)
- **Token expiry**: 24 hours
- **Password hashing**: bcrypt
- **Login rate limiting**: 5 attempts per 15-minute window, then 15-minute lockout
- **Audit logging**: All login attempts (success and failure) are logged
- **Session revocation**: Not currently supported (stateless JWT). Redis blocklist planned for future.

## Access Control Examples

### Example 1: Lead views team scores

```
Request: GET /api/scores?period=2024-Q1
User: { role: "lead", teamId: "ops-team" }

1. requireAuth() → validates JWT, extracts user
2. checkAuthorization("lead", "score", "view") → allowed (actions include "view")
3. applyScopeFilter(query, "team") → adds WHERE teamId = "ops-team"
4. Returns only scores for ops-team employees
```

### Example 2: Employee tries to export data

```
Request: GET /api/export?format=csv
User: { role: "employee" }

1. requireAuth() → validates JWT
2. checkAuthorization("employee", "export", "export") → DENIED
   employee.export = { actions: [], scope: "none" }
3. Returns 403 Forbidden
```

### Example 3: Auditor views travel rule case with masked fields

```
Request: GET /api/travel-rule/cases/123
User: { role: "auditor" }

1. requireAuth() → validates JWT
2. checkAuthorization("auditor", "travel_rule_case", "view") → allowed
3. applyScopeFilter(query, "all") → no filter
4. Response masks: senderAddress → "***", receiverAddress → "***", emailSentTo → "***"
```
