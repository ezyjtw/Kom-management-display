# ADR-001: Authentication and Session Model

**Status:** Accepted
**Date:** 2026-03-08
**Decision Makers:** Platform Team

## Context

KOMmand Centre is an internal operations dashboard for institutional digital asset custody.
It handles sensitive financial data, compliance workflows, and multi-team operations.
The auth model must balance security with operational usability — operators need reliable
access during shifts without excessive re-authentication, while privileged actions require
stronger controls.

## Decision

- **Provider:** NextAuth.js with credentials provider (email + bcrypt-hashed password).
- **Session strategy:** Stateless JWT tokens stored in HTTP-only cookies.
- **Token lifetime:** 8 hours default, with role-based idle timeouts:
  - Admin: 2 hours
  - Lead/Auditor: 4 hours
  - Employee: 8 hours
- **Session revocation:** JWT is stateless, but a `SessionMetadata` table provides:
  - Active session visibility
  - Explicit revocation (single session or all user sessions)
  - IP/user-agent tracking for anomaly detection
  - 5-minute in-memory cache for revoked token checks
- **Password policy:** 12+ characters, 4 character classes, common password blocklist,
  similarity rejection, sequential/repeating character detection. BCRYPT_ROUNDS=12.
- **Rate limiting:** 5 attempts per 15 minutes with 15-minute lockout.
  Successful login resets the counter.
- **Audit:** Every login attempt (success and failure) is logged to `AuditLog`.

## Alternatives Considered

1. **OAuth/OIDC with external IDP (Okta, Auth0):** Would provide MFA out of the box,
   but adds external dependency and cost. Appropriate for Phase 2 when SSO is required.
2. **Database sessions instead of JWT:** Better revocation but adds DB round-trip to
   every request. The hybrid approach (JWT + revocation table) provides both performance
   and revocability.
3. **Shorter token lifetimes (e.g., 1 hour) with refresh tokens:** NextAuth.js JWT
   strategy doesn't natively support refresh tokens. The idle timeout mechanism achieves
   similar security guarantees with less complexity.

## Consequences

- Stateless JWTs mean revocation is eventually consistent (up to 5 min cache TTL).
- Password-based auth means MFA is not yet available (planned for Phase 2).
- Role-based idle timeouts mean privileged users re-auth more frequently.
- All authentication events are auditable and queryable.

## Related

- `src/lib/auth-options.ts` — NextAuth configuration
- `src/middleware.ts` — JWT validation, idle timeout enforcement
- `src/lib/session-revocation.ts` — Revocation logic
- `src/lib/password-policy.ts` — Password enforcement
- `src/lib/rate-limit.ts` — Login rate limiting
