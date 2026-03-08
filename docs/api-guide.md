# API Route Guide

## Authentication
All API routes require a valid JWT session (via NextAuth). Pass the session cookie automatically or use the `Authorization` header for service-to-service calls.

## Response Format
All responses follow this standard shape:

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

## Endpoints

### Health
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | No | Overall health + DB check |
| GET | `/api/health/liveness` | No | Simple liveness probe |
| GET | `/api/health/readiness` | No | Full readiness check (DB, env, integrations) |

### Scores
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/scores` | Yes | Raw scores (legacy, supports filters) |
| GET | `/api/scores/overview` | Yes | Dashboard overview with trends + flags |
| GET | `/api/scores/employee/:id` | Yes | Detailed employee scores with explanation |
| GET | `/api/scores/periods` | Yes | Available scoring periods |
| GET | `/api/scores/config` | Yes | Active scoring configuration |
| POST | `/api/scores` | Admin/Lead | Create/update a score |
| POST | `/api/scores/config` | Admin/Lead | Create new config draft |
| PUT | `/api/scores/config` | Admin | Activate a config |

### Employees
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/employees` | Yes | List employees (scoped) |
| GET | `/api/employees/:id` | Yes | Employee detail |
| POST | `/api/employees` | Admin | Create employee |
| PUT | `/api/employees/:id` | Admin/Lead | Update employee |

### Comms
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/comms/threads` | Yes | List threads (scoped) |
| GET | `/api/comms/threads/:id` | Yes | Thread detail with timeline |
| POST | `/api/comms/threads` | Yes | Create thread |
| PUT | `/api/comms/threads/:id` | Yes | Update thread |
| POST | `/api/comms/threads/:id/take` | Yes | Take ownership |
| POST | `/api/comms/threads/:id/transfer` | Yes | Transfer ownership |
| POST | `/api/comms/threads/:id/notes` | Yes | Add internal note |
| PUT | `/api/comms/threads/:id/status` | Yes | Change thread status |
| PUT | `/api/comms/threads/:id/secondaries` | Yes | Update watchers |

### Alerts
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/comms/alerts` | Yes | List active alerts |
| POST | `/api/alerts/generate` | Cron/Admin | Generate SLA breach alerts |

### Travel Rule
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/travel-rule` | Yes | Overview with reconciliation |
| GET | `/api/travel-rule/cases` | Yes | List cases |
| GET | `/api/travel-rule/cases/:id` | Yes | Case detail |
| POST | `/api/travel-rule/cases` | Yes | Create case |
| PUT | `/api/travel-rule/cases/:id` | Yes | Update case |
| POST | `/api/travel-rule/cases/:id/notes` | Yes | Add case note |

### Export
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/export` | Admin/Lead/Auditor | Export data (CSV/JSON) |

### Audit
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/audit` | Admin | Query audit logs |

### Integrations
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/integrations/health` | Admin | Integration health status |
| POST | `/api/integrations/slack` | Admin | Trigger Slack sync |
| POST | `/api/integrations/email` | Admin | Trigger email sync |
| POST | `/api/integrations/jira` | Admin | Trigger Jira sync |

### Command Centre
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/command-center` | Yes | Aggregated operational overview |

## Error Codes
| Code | HTTP Status | Description |
|------|-------------|-------------|
| VALIDATION_ERROR | 400 | Invalid request data |
| AUTH_REQUIRED | 401 | Not authenticated |
| FORBIDDEN | 403 | Insufficient permissions |
| NOT_FOUND | 404 | Resource not found |
| CONFLICT | 409 | Duplicate record |
