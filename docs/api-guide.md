# API Route Guide

## Authentication

All API routes (except health checks) require a valid JWT session via NextAuth.

**Browser clients**: Session cookie is sent automatically after login via `/api/auth/signin`.

**Service-to-service**: Use the `Authorization: Bearer <token>` header.

**Cron endpoints**: Use the `x-cron-secret` header with the value from `CRON_SECRET` env var.

### Authentication Flow

```
1. Client POST /api/auth/callback/credentials { email, password }
2. Server validates credentials (bcrypt compare)
3. Rate limit check (5 attempts / 15 min window)
4. On success: JWT issued with { id, role, team, employeeId }, 24h expiry
5. Cookie set: next-auth.session-token (httpOnly, secure, sameSite=lax)
6. Subsequent requests: cookie auto-sent, JWT decoded by middleware
7. On failure: 401 + login attempt logged to audit log
```

## Response Format

All responses follow a standard envelope:

```json
// Success
{
  "success": true,
  "data": { ... },
  "requestId": "a1b2c3d4",
  "meta": { "timestamp": "..." }
}

// Error
{
  "success": false,
  "error": "Human-readable message",
  "code": "VALIDATION_ERROR",
  "requestId": "a1b2c3d4"
}

// Paginated
{
  "success": true,
  "data": [...],
  "pagination": { "page": 1, "pageSize": 25, "total": 100, "totalPages": 4 },
  "requestId": "a1b2c3d4"
}
```

## Pagination

Paginated endpoints accept these query parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `page` | `1` | Page number (1-based) |
| `pageSize` | `25` | Items per page (max 100) |
| `sortBy` | varies | Field to sort by |
| `sortOrder` | `desc` | `asc` or `desc` |

Response includes a `pagination` object with `page`, `pageSize`, `total`, and `totalPages`.

## Rate Limiting

Login endpoint is rate-limited using a sliding window:

| Parameter | Value |
|-----------|-------|
| Max attempts | 5 per identifier (email or IP) |
| Window | 15 minutes |
| Lockout duration | 15 minutes |
| Reset | On successful login |
| Implementation | In-memory (Redis-ready for horizontal scaling) |

API routes do not currently have per-endpoint rate limiting beyond login.

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request data (missing fields, wrong types) |
| `AUTH_REQUIRED` | 401 | Not authenticated or token expired |
| `FORBIDDEN` | 403 | Authenticated but insufficient permissions for this resource/action |
| `NOT_FOUND` | 404 | Resource does not exist or not visible in user's scope |
| `CONFLICT` | 409 | Duplicate record (e.g., duplicate sourceId in integration) |
| `RATE_LIMITED` | 429 | Too many login attempts, retry after lockout period |
| `INTERNAL_ERROR` | 500 | Unexpected server error (logged with requestId for debugging) |

## Endpoints

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | No | Overall health + DB latency + version info |
| GET | `/api/health/liveness` | No | Simple liveness probe (returns 200 if app is running) |
| GET | `/api/health/readiness` | No | Full readiness check (DB connectivity, env vars, integrations) |

**Response example** (`GET /api/health`):
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "database": { "connected": true, "latencyMs": 3 },
  "uptime": 86400
}
```

---

### Scores

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/scores` | Yes | Raw scores with filters (period, team, employee) |
| GET | `/api/scores/overview` | Yes | Dashboard overview with trends + flags |
| GET | `/api/scores/employee/:id` | Yes | Detailed employee scores with explanation breakdown |
| GET | `/api/scores/periods` | Yes | Available scoring periods |
| GET | `/api/scores/config` | Yes | Active scoring configuration |
| POST | `/api/scores` | Admin/Lead | Create or update a score |
| POST | `/api/scores/config` | Admin/Lead | Create new config draft |
| PUT | `/api/scores/config` | Admin | Activate a config (draft → review → approved → active) |

**GET `/api/scores`** query parameters: `period`, `teamId`, `employeeId`, `page`, `pageSize`

**POST `/api/scores`** request body:
```json
{
  "employeeId": "emp-123",
  "period": "2024-Q1",
  "category": "daily_tasks",
  "rawIndex": 85,
  "notes": "Consistent performance"
}
```

---

### Employees

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/employees` | Yes | List employees (scope-filtered by role) |
| GET | `/api/employees/:id` | Yes | Employee detail with team info |
| POST | `/api/employees` | Admin | Create employee |
| PUT | `/api/employees/:id` | Admin/Lead | Update employee details |

---

### Comms (Threads)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/comms/threads` | Yes | List threads (scope-filtered) |
| GET | `/api/comms/threads/:id` | Yes | Thread detail with full timeline |
| POST | `/api/comms/threads` | Yes | Create new thread |
| PUT | `/api/comms/threads/:id` | Yes | Update thread metadata |
| POST | `/api/comms/threads/:id/take` | Yes | Take ownership of a thread |
| POST | `/api/comms/threads/:id/transfer` | Yes | Transfer ownership to another user |
| POST | `/api/comms/threads/:id/notes` | Yes | Add internal note to thread |
| PUT | `/api/comms/threads/:id/status` | Yes | Change thread status (open/in_progress/resolved/closed) |
| PUT | `/api/comms/threads/:id/secondaries` | Yes | Update secondary watchers |

**POST `/api/comms/threads/:id/transfer`** request body:
```json
{
  "toUserId": "user-456",
  "reason": "Reassigning due to team change"
}
```

---

### Alerts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/comms/alerts` | Yes | List active alerts (scope-filtered) |
| POST | `/api/alerts/generate` | Cron/Admin | Generate SLA breach alerts |

---

### Travel Rule

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/travel-rule` | Yes | Overview with reconciliation stats |
| GET | `/api/travel-rule/cases` | Yes | List cases (scope-filtered) |
| GET | `/api/travel-rule/cases/:id` | Yes | Case detail (sensitive fields masked for non-admin) |
| POST | `/api/travel-rule/cases` | Yes | Create case |
| PUT | `/api/travel-rule/cases/:id` | Yes | Update case |
| POST | `/api/travel-rule/cases/:id/notes` | Yes | Add case note |

---

### Export

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/export` | Admin/Lead/Auditor | Export data in CSV or JSON format |

**Query parameters**: `format` (csv/json), `resource`, `dateFrom`, `dateTo`, `teamId`

All exports are logged to the audit trail with the requesting user, filters applied, and row count.

---

### Audit

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/audit` | Admin | Query audit logs with filters |

**Query parameters**: `action`, `resource`, `userId`, `dateFrom`, `dateTo`, `page`, `pageSize`

---

### Integrations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/integrations/health` | Admin | Health status of all integration connectors |
| POST | `/api/integrations/slack` | Admin | Trigger manual Slack sync |
| POST | `/api/integrations/email` | Admin | Trigger manual email/IMAP sync |
| POST | `/api/integrations/jira` | Admin | Trigger manual Jira sync |

**GET `/api/integrations/health`** response example:
```json
{
  "success": true,
  "data": [
    {
      "source": "slack",
      "configured": true,
      "status": "healthy",
      "lastSuccessfulSync": "2024-01-15T10:30:00Z",
      "failureCount": 0,
      "queueBacklog": 0
    }
  ]
}
```

---

### Command Centre

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/command-center` | Yes | Aggregated operational overview (threads, alerts, scores, cases) |

---

### Market Data

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/market-data` | Yes | Market data feed (rate-limited) |
