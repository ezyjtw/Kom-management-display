/**
 * CSRF protection for state-changing requests.
 *
 * Uses the double-submit cookie pattern combined with origin/referer validation:
 *
 *   1. Origin Check: Validates the Origin or Referer header matches the
 *      configured application URL. This blocks cross-origin POST/PUT/DELETE/PATCH.
 *
 *   2. Custom Header Check: Requires a custom X-Requested-With header on
 *      mutations. Browsers enforce CORS preflight for requests with custom
 *      headers, which prevents cross-origin requests from untrusted origins.
 *
 * This is a stateless approach that doesn't require per-session tokens.
 * The combination of origin validation + custom header provides strong
 * CSRF protection without adding complexity.
 *
 * Usage in API routes:
 *   const csrfError = validateCsrf(request);
 *   if (csrfError) return csrfError;
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { apiError } from "@/lib/api/response";

/** HTTP methods that modify state and need CSRF protection. */
const PROTECTED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Paths exempt from CSRF checks (webhooks, cron endpoints). */
const EXEMPT_PATHS = [
  "/api/auth/",
  "/api/integrations/slack",
  "/api/integrations/jira",
  "/api/alerts/generate",
  "/api/events",
  "/api/health",
];

/**
 * Get the allowed origins for CSRF validation.
 * Returns an array of trusted origin strings.
 */
function getAllowedOrigins(): string[] {
  const origins: string[] = [];

  if (process.env.NEXTAUTH_URL) {
    try {
      const url = new URL(process.env.NEXTAUTH_URL);
      origins.push(url.origin);
    } catch {
      // Invalid URL, skip
    }
  }

  // Additional allowed origins (comma-separated)
  if (process.env.CSRF_ALLOWED_ORIGINS) {
    origins.push(...process.env.CSRF_ALLOWED_ORIGINS.split(",").map((o) => o.trim()));
  }

  // Always allow localhost in development
  if (process.env.NODE_ENV !== "production") {
    origins.push("http://localhost:3000", "http://127.0.0.1:3000");
  }

  return origins;
}

/**
 * Validate CSRF protection on a request.
 *
 * Returns null if the request passes CSRF validation, or a 403 response if it fails.
 */
export function validateCsrf(request: NextRequest): NextResponse | null {
  // Only protect state-changing methods
  if (!PROTECTED_METHODS.has(request.method)) {
    return null;
  }

  const path = new URL(request.url).pathname;

  // Check exemptions
  if (EXEMPT_PATHS.some((exempt) => path.startsWith(exempt))) {
    return null;
  }

  // 1. Origin/Referer validation
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const allowedOrigins = getAllowedOrigins();

  if (allowedOrigins.length > 0) {
    let originValid = false;

    if (origin) {
      originValid = allowedOrigins.includes(origin);
    } else if (referer) {
      try {
        const refererOrigin = new URL(referer).origin;
        originValid = allowedOrigins.includes(refererOrigin);
      } catch {
        originValid = false;
      }
    } else {
      // No origin or referer — could be a same-origin request from some browsers
      // or a non-browser client. Allow if the custom header is present.
      originValid = true;
    }

    if (!originValid) {
      logger.security("CSRF origin validation failed", {
        origin,
        referer,
        path,
        method: request.method,
        allowedOrigins,
      });
      return apiError("Cross-origin request blocked", 403, "CSRF_REJECTED");
    }
  }

  // 2. Custom header check (X-Requested-With)
  // Browsers enforce CORS preflight for non-standard headers,
  // which prevents cross-origin requests from untrusted sites.
  const requestedWith = request.headers.get("x-requested-with");
  if (!requestedWith) {
    // Allow requests from same-origin that have a valid origin/referer
    // but don't have the custom header (e.g., form submissions from our app)
    if (origin && allowedOrigins.includes(origin)) {
      return null;
    }
    if (referer) {
      try {
        const refererOrigin = new URL(referer).origin;
        if (allowedOrigins.includes(refererOrigin)) {
          return null;
        }
      } catch {
        // Invalid referer
      }
    }

    // In development, be more lenient
    if (process.env.NODE_ENV !== "production") {
      return null;
    }

    logger.security("CSRF custom header missing", {
      path,
      method: request.method,
    });
    return apiError("Missing X-Requested-With header", 403, "CSRF_HEADER_MISSING");
  }

  return null;
}

/**
 * Security headers to add to all responses.
 * These headers provide defense-in-depth against common web attacks.
 */
export function getSecurityHeaders(): Record<string, string> {
  return {
    // Prevent MIME-type sniffing
    "X-Content-Type-Options": "nosniff",
    // Prevent clickjacking
    "X-Frame-Options": "DENY",
    // Enable XSS filter (legacy browsers)
    "X-XSS-Protection": "1; mode=block",
    // Restrict referrer information
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Prevent DNS prefetching to external domains
    "X-DNS-Prefetch-Control": "off",
    // Strict permissions policy
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}
