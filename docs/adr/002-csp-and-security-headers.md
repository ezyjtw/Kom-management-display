# ADR-002: Content Security Policy and Security Headers

**Status:** Accepted
**Date:** 2026-03-08
**Decision Makers:** Platform Team

## Context

The platform serves an internal operations dashboard that handles sensitive financial
data. CSP and security headers must prevent XSS, clickjacking, MIME sniffing, and
other client-side attacks while remaining compatible with the Next.js 14 App Router,
Tailwind CSS, and Radix UI runtime requirements.

## Decision

### CSP Policy

```
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
connect-src 'self';
frame-ancestors 'none';
frame-src 'none';
base-uri 'self';
form-action 'self';
object-src 'none';
worker-src 'self';
manifest-src 'self';
upgrade-insecure-requests;
```

### Why `'unsafe-inline'` is required

1. **`script-src 'unsafe-inline'`:** Next.js App Router injects inline `<script>` tags
   during hydration. The App Router does not yet propagate nonces to these scripts
   (tracked: vercel/next.js#43743). `'unsafe-eval'` is NOT included — eval is blocked.
   When Next.js adds nonce support for App Router, this should be replaced.

2. **`style-src 'unsafe-inline'`:** Tailwind CSS and Radix UI inject styles via CSSOM
   at runtime. This is a lower-risk allowance than script inline because CSS cannot
   execute code. Hash-based CSP for styles would require enumerating every injected
   style, which is impractical with utility-first CSS frameworks.

### Other Security Headers

Applied in both `next.config.js` (static) and middleware (dynamic):

| Header | Value | Purpose |
|--------|-------|---------|
| X-Frame-Options | DENY | Clickjacking prevention |
| X-Content-Type-Options | nosniff | MIME sniffing prevention |
| Referrer-Policy | strict-origin-when-cross-origin | Referrer leakage control |
| Strict-Transport-Security | max-age=31536000; includeSubDomains | HTTPS enforcement |
| Permissions-Policy | camera=(), microphone=(), geolocation=() | Feature restriction |
| X-XSS-Protection | 1; mode=block | Legacy browser XSS filter |
| X-DNS-Prefetch-Control | off | DNS prefetch restriction |

### CSRF Protection

State-changing requests (POST/PUT/PATCH/DELETE) are protected by:
1. Origin/Referer validation against allowed origins
2. Custom header check (`X-Requested-With`) in production
3. Webhook endpoints are exempt (they use HMAC signature verification)

## Alternatives Considered

1. **Nonce-based CSP:** Ideal but not yet supported by Next.js App Router.
   The Pages Router supports nonces via `_document.tsx`, but migrating back
   would lose App Router benefits (RSC, streaming, layouts).
2. **Hash-based CSP for scripts:** Would require extracting hashes of every
   inline script Next.js generates, which changes per build. Not maintainable.
3. **Remove all inline scripts:** Not possible with Next.js — the framework
   controls hydration script injection.

## Consequences

- XSS via inline script injection is theoretically possible but mitigated by:
  input sanitization, output encoding (React's default), and trusted content only.
- The CSP should be tightened when Next.js adds App Router nonce support.
- CI should include a test that fails if CSP is weakened (e.g., `'unsafe-eval'` added).

## Related

- `next.config.js` — Static security headers and CSP
- `src/middleware.ts` — Dynamic security headers on all responses
- `src/lib/csrf.ts` — CSRF protection utilities
- `src/lib/sanitize.ts` — Input sanitization
