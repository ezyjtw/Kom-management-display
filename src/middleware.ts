import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { lookupSensitiveAction } from "@/modules/auth/sensitive-actions-registry";

/**
 * Role-based idle timeout in seconds. Privileged roles get shorter timeouts.
 *
 * NOTE: In Edge middleware, we can only use token.iat as a rough approximation.
 * Accurate idle tracking happens in requireAuth() (src/lib/auth-user.ts) via
 * lastActiveAt DB lookup in the SessionMetadata table.
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

/** HTTP methods that modify state. */
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Paths exempt from CSRF origin validation.
 * Each path is exempt because it receives requests from external services
 * that won't have a matching origin/referer header.
 */
const CSRF_EXEMPT_PATHS = [
  "/api/auth/",             // NextAuth callback flow (OAuth redirects from providers)
  "/api/webhooks/slack",    // Slack webhook deliveries (verified via signing secret)
  "/api/webhooks/jira",     // Jira webhook deliveries (verified via signature)
  "/api/alerts/generate",   // Cron/external trigger (verified via CRON_SECRET bearer token)
  "/api/events",            // SSE endpoint (GET-only, no mutation risk)
  "/api/health",            // Health check endpoint (no auth, no mutation)
];

/**
 * Security headers applied to every response.
 * Kept in sync with getSecurityHeaders() in src/lib/csrf.ts and next.config.js.
 * Defined inline here because middleware runs in Edge Runtime and cannot
 * transitively import Node.js crypto (used by api/response.ts).
 */
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "0",
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
 * Runs in Edge Runtime. For production mutations, requires a valid origin OR referer header.
 * No x-requested-with fallback — tightened to require origin/referer proof.
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
    }
    // No fallback: production mutations MUST have a valid origin or referer header.

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
  const webhookPaths = ["/api/webhooks/slack", "/api/webhooks/jira"];
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

  // Session revocation is checked at the route handler level in requireAuth()
  // (src/lib/auth-user.ts) where Prisma IS available. Edge middleware cannot
  // use Prisma directly, and self-fetching /api/sessions/check is an anti-pattern.
  const role = token.role as string;

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

    // Role-based idle timeout — uses token.iat as a rough approximation only.
    // Real idle tracking happens in requireAuth() via lastActiveAt DB lookup
    // (updated by updateLastActive() on each authenticated request).
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

    // Sensitive action freshness check — require recent session for high-risk
    // ops. The sensitive-action registry is the single source of truth (shared
    // with route-level audit), replacing the previously duplicated map.
    if (isApi && MUTATION_METHODS.has(req.method)) {
      const sensitive = lookupSensitiveAction(req.method, path);
      if (sensitive && ageSeconds > sensitive.maxSessionAgeSeconds) {
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
        // Forward the HTTP method so route-level auth can apply a stricter
        // (fail-closed) session-revocation policy on state-changing requests.
        "x-http-method": req.method,
      }),
    },
  });

  // Propagate correlation ID and security context to response
  response.headers.set("x-correlation-id", correlationId);
  response.headers.set("x-request-id", correlationId);
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
    "/api/webhooks/:path*",
    "/api/compliance-bot/:path*",
    "/api/admin/:path*",
    "/api/branding/:path*",
    "/api/client-comms/:path*",
    "/api/client-preferences/:path*",
    "/client-comms/:path*",
  ],
};
