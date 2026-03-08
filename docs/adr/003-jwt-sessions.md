# ADR-003: JWT Sessions via NextAuth

## Status
Accepted

## Context
Internal ops platform needs authentication for role-based access. Requirements:
- Credentials-based login (email + password)
- Role and team carried on session (admin, lead, employee, auditor)
- No external identity provider dependency for MVP
- Stateless session for horizontal scaling

## Decision
Use **NextAuth** with **JWT strategy** and **CredentialsProvider**.

## Consequences
- **Positive**: Stateless (no session store needed), role/team encoded in token, 24h expiry
- **Negative**: Cannot revoke individual sessions without a blocklist, JWT size grows with claims
- **Mitigation**: Keep token claims minimal (id, role, team, employeeId). Add session revocation via Redis blocklist when needed. Add MFA for admin/lead roles in future.

## Security Controls
- bcrypt password hashing
- Login rate limiting (5 attempts / 15 min window)
- Login audit logging (success + failure)
- HTTPS enforcement via HSTS
