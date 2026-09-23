# CLAUDE.md — KOMmand Centre Standing Rules

## Hard Constraints (H1–H11)

These constraints apply to **every** phase and must never be violated:

| ID  | Rule |
|-----|------|
| H1  | No transaction approval — the tool never executes, signs, or approves any transaction |
| H2  | Komainu/Custody API is read-only — only GET endpoints are used |
| H3  | AI is off by default — `AI_PROVIDER` defaults to `none`; feature flag `ai.enabled` must be `false` |
| H4  | No staff surveillance — no screen monitoring, keystroke logging, or location tracking |
| H5  | No local risk scoring — risk levels come from the custody source system, never computed locally |
| H6  | No new wallet/key technology — the tool never generates, stores, or manages private keys |
| H7  | No secrets in code — all credentials via env vars; `.env` is in `.gitignore` |
| H8  | Redact sensitive data in logs — PII, keys, addresses masked in all log output |
| H9  | No production targets — `.env.example` must never contain real API endpoints |
| H10 | Remove Railway config — no `railway.json`, `railway.toml`, or `Procfile` |
| H11 | Notabene disabled — feature flag `integration.notabene.enabled` defaults to `false` |

## Branch and PR Discipline

- One phase per branch / PR
- Branch name pattern: `phase-N-short-description`
- Run `npm run ci:check` before every commit
- Tests for every new behaviour
- STOP at each phase boundary and report

## Code Style

- TypeScript strict mode
- Zod for all external input validation
- Prisma for database access
- Next.js App Router conventions
- No `any` types without explicit justification
