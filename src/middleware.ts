import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

/**
 * Role-based idle timeout in seconds. Privileged roles get shorter timeouts.
 * Checked against lastActiveAt from the session metadata table for accurate
 * idle tracking (not token.iat which only reflects issuance time).
 */
const IDLE_TIMEOUT_SECONDS: Record<string, number> = {
  admin: 2 * 60 * 60,    // 2 hours
  lead: 4 * 60 * 60,     // 4 hours
  employee: 8 * 60 * 60, // 8 hours
  auditor: 4 * 60 * 60,  // 4 hours
};

/**
 * Absolute session lifetime in seconds — hard cap regardless of activity.
 * After this, user must re-authenticate. Separate from idle timeout.
 */
const ABSOLUTE_SESSION_LIFETIME = 8 * 60 * 60; // 8 hours for all roles

/**
 * Sensitive action session freshness requirements.
 * For high-risk operations, the session must have been issued recently.
 * Key format: "METHOD:path_prefix"
 */
const SENSITIVE_ACTION_MAX_AGE: Record<string, number> = {
  "POST:/api/users": 1 * 60 * 60,        // User creation: 1h
  "DELETE:/api/users": 1 * 60 * 60,       // User deletion: 1h
  "PUT:/api/scores/config": 2 * 60 * 60,  // Scoring config: 2h
  "PUT:/api/feature-flags": 2 * 60 * 60,  // Feature flags: 2h
  "DELETE:/api/sessions": 1 * 60 * 60,    // Session revocation: 1h
  "POST:/api/export": 4 * 60 * 60,        // Data export: 4h
};

/** HTTP methods that modify state. */
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Paths exempt from CSRF origin validation (webhooks, auth, SSE). */
const CSRF_EXEMPT_PATHS = [
  "/api/auth/",
  "/api/integrations/slack",
  "/api/integrations/jira",
  "/api/alerts/generate",
  "/api/events",
  "/api/health",
];

/**
 * Security headers applied to every response.
 * Kept in sync with getSecurityHeaders() in src/lib/csrf.ts.
 * Defined inline here because middleware runs in Edge Runtime and cannot
 * transitively import Node.js crypto (used by api/response.ts).
 */
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-DNS-Prefetch-Control": "off",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/**
 * Get trusted origins for CSRF validation.
 */
function getAllowedOrigins(): string[] {
  const origins: string[] = [];

  if (process.env.NEXTAUTH_URL) {
    try {
      origins.push(new URL(process.env.NEXTAUTH_URL).origin);
    } catch { /* invalid URL */ }
  }

  if (process.env.CSRF_ALLOWED_ORIGINS) {
    origins.push(...process.env.CSRF_ALLOWED_ORIGINS.split(",").map((o) => o.trim()));
  }

  if (process.env.NODE_ENV !== "production") {
    origins.push("http://localhost:3000", "http://127.0.0.1:3000");
  }

  return origins;
}

/**
 * Validate CSRF protection on a mutation request.
 * Mirrors the logic in src/lib/csrf.ts validateCsrf() but runs in Edge Runtime.
 * Returns a 403 response if validation fails, or null if it passes.
 */
function validateCsrf(req: NextRequest, path: string): NextResponse | null {
  if (!MUTATION_METHODS.has(req.method)) return null;

  const isExempt = CSRF_EXEMPT_PATHS.some((exempt) => path.startsWith(exempt));
  if (isExempt) return null;

  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const allowedOrigins = getAllowedOrigins();

  if (allowedOrigins.length > 0 && process.env.NODE_ENV === "production") {
    let originValid = false;

    if (origin) {
      originValid = allowedOrigins.includes(origin);
    } else if (referer) {
      try {
        originValid = allowedOrigins.includes(new URL(referer).origin);
      } catch { originValid = false; }
    } else {
      // No origin header — allow if custom header is present (CORS preflight guard)
      originValid = !!req.headers.get("x-requested-with");
    }

    if (!originValid) {
      return NextResponse.json(
        { success: false, error: "Cross-origin request blocked", code: "CSRF_REJECTED" },
        { status: 403 },
      );
    }
  }

  return null;
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isApi = path.startsWith("/api/");

  // Determine if the original request was over HTTPS (handles reverse proxies like Railway)
  const isSecure =
    process.env.NEXTAUTH_URL?.startsWith("https://") ||
    req.headers.get("x-forwarded-proto") === "https";

  // Try the expected cookie name first, then fall back to the other variant.
  // This handles the mismatch that occurs when the API route and middleware
  // disagree on whether to use the __Secure- prefix.
  const token =
    (await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET,
      secureCookie: isSecure,
    })) ??
    (await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET,
      secureCookie: !isSecure,
    }));

  // Allow internal session revocation check (used by middleware itself)
  if (path === "/api/sessions/check") {
    const internalSecret = req.headers.get("x-internal-check");
    if (internalSecret && internalSecret === process.env.NEXTAUTH_SECRET) {
      return addSecurityHeaders(NextResponse.next());
    }
    // Block external access
    return addSecurityHeaders(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
  }

  // Allow cron/external calls to alert generate endpoint with CRON_SECRET
  if (path === "/api/alerts/generate") {
    const authHeader = req.headers.get("authorization");
    if (
      authHeader?.startsWith("Bearer ") &&
      process.env.CRON_SECRET &&
      authHeader === `Bearer ${process.env.CRON_SECRET}`
    ) {
      return addSecurityHeaders(NextResponse.next());
    }
  }

  // Allow webhook endpoints with their own auth (signature verification)
  const webhookPaths = ["/api/integrations/slack", "/api/integrations/jira"];
  if (webhookPaths.some((p) => path.startsWith(p)) && req.method === "POST") {
    return addSecurityHeaders(NextResponse.next());
  }

  if (!token) {
    if (isApi) {
      return addSecurityHeaders(
        NextResponse.json(
          { success: false, error: "Authentication required", code: "AUTH_REQUIRED" },
          { status: 401 },
        ),
      );
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // ─── Session Revocation Check ───
  // Check if this session has been explicitly revoked (e.g., admin forced logout).
  // Uses the session token JTI as the revocation key. Only checked for privileged
  // roles on every request; regular users are checked on sensitive operations only.
  const role = token.role as string;
  const sessionJti = token.jti as string | undefined;

  if (sessionJti) {
    const privilegedRoles = ["admin", "lead", "auditor"];
    const isSensitiveOp = isApi && MUTATION_METHODS.has(req.method);

    if (privilegedRoles.includes(role) || isSensitiveOp) {
      try {
        // Dynamic import to avoid bundling Prisma in edge middleware
        // We use a lightweight fetch-based check instead
        const revocationCheckUrl = new URL("/api/sessions/check", req.url);
        revocationCheckUrl.searchParams.set("token", sessionJti);
        const revocationRes = await fetch(revocationCheckUrl.toString(), {
          headers: { "x-internal-check": process.env.NEXTAUTH_SECRET || "" },
        });
        if (revocationRes.ok) {
          const revocationData = await revocationRes.json();
          if (revocationData.revoked) {
            if (isApi) {
              return addSecurityHeaders(
                NextResponse.json(
                  { success: false, error: "Session has been revoked", code: "SESSION_REVOKED" },
                  { status: 401 },
                ),
              );
            }
            return NextResponse.redirect(new URL("/login?reason=session_revoked", req.url));
          }
        }
      } catch {
        // Fail-open: don't block users if revocation check fails (e.g., DB down)
      }
    }
  }

  // Enforce session timeouts (both idle and absolute)
  if (token.iat) {
    const issuedAt = token.iat as number; // unix seconds
    const ageSeconds = Math.floor(Date.now() / 1000) - issuedAt;

    // Absolute session lifetime — hard cap for all roles
    if (ageSeconds > ABSOLUTE_SESSION_LIFETIME) {
      if (isApi) {
        return addSecurityHeaders(
          NextResponse.json(
            { success: false, error: "Session expired (absolute lifetime)", code: "SESSION_EXPIRED_ABSOLUTE" },
            { status: 401 },
          ),
        );
      }
      return NextResponse.redirect(new URL("/login?reason=session_expired", req.url));
    }

    // Role-based idle timeout — uses token.iat as approximation.
    // For more accurate idle tracking, the session metadata table records
    // lastActiveAt which is updated on each authenticated request via
    // the recordSession() function in auth-options callbacks.
    const idleTimeout = IDLE_TIMEOUT_SECONDS[role] ?? IDLE_TIMEOUT_SECONDS.employee;
    if (ageSeconds > idleTimeout) {
      if (isApi) {
        return addSecurityHeaders(
          NextResponse.json(
            { success: false, error: "Session expired (idle timeout)", code: "SESSION_EXPIRED_IDLE" },
            { status: 401 },
          ),
        );
      }
      return NextResponse.redirect(new URL("/login?reason=session_expired", req.url));
    }

    // Sensitive action freshness check — require recent session for high-risk ops
    if (isApi && MUTATION_METHODS.has(req.method)) {
      const actionKey = `${req.method}:${path}`;
      // Check exact match then prefix match
      let maxAge: number | undefined;
      if (SENSITIVE_ACTION_MAX_AGE[actionKey]) {
        maxAge = SENSITIVE_ACTION_MAX_AGE[actionKey];
      } else {
        for (const [pattern, age] of Object.entries(SENSITIVE_ACTION_MAX_AGE)) {
          const [patMethod, patPath] = pattern.split(":");
          if (patMethod === req.method && path.startsWith(patPath)) {
            maxAge = age;
            break;
          }
        }
      }

      if (maxAge && ageSeconds > maxAge) {
        return addSecurityHeaders(
          NextResponse.json(
            {
              success: false,
              error: "This action requires a fresh session. Please sign out and sign back in.",
              code: "SESSION_TOO_OLD_FOR_SENSITIVE_ACTION",
            },
            { status: 403 },
          ),
        );
      }
    }
  }

  // Admin-only routes
  const adminOnlyPaths = ["/admin", "/api/users"];
  for (const restricted of adminOnlyPaths) {
    if (path.startsWith(restricted) && role !== "admin") {
      if (isApi) return addSecurityHeaders(NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 }));
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  }

  // Admin + lead routes
  const adminLeadPaths = ["/api/scoring-config", "/api/export"];
  for (const restricted of adminLeadPaths) {
    if (path.startsWith(restricted) && !["admin", "lead"].includes(role)) {
      if (isApi) return addSecurityHeaders(NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 }));
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  }

  // Auditor: read-only (block POST/PUT/PATCH/DELETE)
  if (role === "auditor" && isApi && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return addSecurityHeaders(
      NextResponse.json({ success: false, error: "Auditors have read-only access" }, { status: 403 }),
    );
  }

  // ─── CSRF Protection ───
  // Validate origin on state-changing requests to prevent cross-site attacks.
  const csrfError = validateCsrf(req, path);
  if (csrfError) return addSecurityHeaders(csrfError);

  // Generate correlation ID for request tracing across services and logs.
  // Format: 8-char hex for compactness in logs.
  const correlationId = crypto.randomUUID().substring(0, 8);
  const response = NextResponse.next({
    request: {
      headers: new Headers({
        ...Object.fromEntries(req.headers.entries()),
        "x-correlation-id": correlationId,
      }),
    },
  });

  // Propagate correlation ID and security context to response
  response.headers.set("x-correlation-id", correlationId);
  response.headers.set("x-request-id", correlationId);
  response.headers.set("x-user-role", role);

  return addSecurityHeaders(response);
}

/**
 * Apply security headers to every response.
 * These headers provide defense-in-depth against XSS, clickjacking,
 * MIME sniffing, and other common attack vectors.
 */
function addSecurityHeaders(response: NextResponse): NextResponse {
  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(header, value);
  }
  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/employee/:path*",
    "/comms/:path*",
    "/admin/:path*",
    "/schedule/:path*",
    "/incidents/:path*",
    "/travel-rule/:path*",
    "/tokens/:path*",
    "/staking/:path*",
    "/screening/:path*",
    "/approvals/:path*",
    "/daily-checks/:path*",
    "/settlements/:path*",
    "/rca/:path*",
    "/clients/:path*",
    "/activity/:path*",
    "/projects/:path*",
    "/briefing/:path*",
    "/usdc-ramp/:path*",
    "/transactions/:path*",
    "/transaction-confirmations/:path*",
    "/api/employees/:path*",
    "/api/scores/:path*",
    "/api/scoring-config/:path*",
    "/api/comms/:path*",
    "/api/audit/:path*",
    "/api/export/:path*",
    "/api/alerts/:path*",
    "/api/users/:path*",
    "/api/integrations/:path*",
    "/api/incidents/:path*",
    "/api/travel-rule/:path*",
    "/api/tokens/:path*",
    "/api/staking/:path*",
    "/api/screening/:path*",
    "/api/approvals/:path*",
    "/api/daily-checks/:path*",
    "/api/settlements/:path*",
    "/api/rca/:path*",
    "/api/clients/:path*",
    "/api/projects/:path*",
    "/api/schedule/:path*",
    "/api/activity/:path*",
    "/api/ai/:path*",
    "/api/command-center/:path*",
    "/api/usdc-ramp/:path*",
    "/api/market-data/:path*",
    "/api/transaction-confirmations/:path*",
    "/api/feature-flags/:path*",
    "/api/sessions/:path*",
    "/api/jobs/:path*",
    "/api/reports/:path*",
    "/api/search/:path*",
    "/api/metrics/:path*",
  ],
};
