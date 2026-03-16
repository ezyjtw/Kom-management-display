/**
 * CSRF protection utilities for route-level use.
 *
 * NOTE: Primary CSRF enforcement happens in src/middleware.ts (Edge Runtime).
 * This module provides utilities for route handlers that need additional
 * CSRF validation. The middleware handles origin/referer validation for
 * all matched routes automatically.
 *
 * Security headers are defined in THREE places (kept in sync manually):
 * 1. src/middleware.ts - applied to all middleware-matched responses
 * 2. next.config.js - applied to all responses including static assets
 * 3. This file (getSecurityHeaders) - available for programmatic use
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { apiError } from "@/lib/api/response";
import { env } from "@/lib/env";

/** HTTP methods that modify state and need CSRF protection. */
const PROTECTED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Paths exempt from CSRF checks.
 * Each path is exempt because it receives requests from external services
 * that won't have a matching origin/referer header.
 */
const EXEMPT_PATHS = [
  "/api/auth/",             // NextAuth callback flow (OAuth redirects from providers)
  "/api/webhooks/slack",    // Slack webhook deliveries (verified via signing secret)
  "/api/webhooks/jira",     // Jira webhook deliveries (verified via signature)
  "/api/alerts/generate",   // Cron/external trigger (verified via CRON_SECRET bearer token)
  "/api/events",            // SSE endpoint (GET-only, no mutation risk)
  "/api/health",            // Health check endpoint (no auth, no mutation)
];

/**
 * Get the allowed origins for CSRF validation.
 * Returns an array of trusted origin strings.
 */
function getAllowedOrigins(): string[] {
  const origins: string[] = [];

  const nextauthUrl = env("NEXTAUTH_URL");
  if (nextauthUrl) {
    try {
      const url = new URL(nextauthUrl);
      origins.push(url.origin);
    } catch {
      // Invalid URL, skip
    }
  }

  // Additional allowed origins (comma-separated)
  const csrfOrigins = env("CSRF_ALLOWED_ORIGINS");
  if (csrfOrigins) {
    origins.push(...csrfOrigins.split(",").map((o) => o.trim()));
  }

  // Always allow localhost in development
  if (process.env.NODE_ENV !== "production") {
    origins.push("http://localhost:3000", "http://127.0.0.1:3000");
  }

  return origins;
}

/**
 * Validate CSRF protection on a request.
 * This is for route-level use. Primary CSRF enforcement is in middleware.ts.
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

  // Origin/Referer validation — no x-requested-with fallback
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const allowedOrigins = getAllowedOrigins();

  if (allowedOrigins.length > 0 && process.env.NODE_ENV === "production") {
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
    }
    // No fallback: production mutations MUST have a valid origin or referer header.

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

  return null;
}

/**
 * Security headers to add to all responses.
 * These headers provide defense-in-depth against common web attacks.
 *
 * NOTE: These same headers are defined in src/middleware.ts and next.config.js.
 * Changes here must be reflected in those locations as well.
 */
export function getSecurityHeaders(): Record<string, string> {
  return {
    // Prevent MIME-type sniffing
    "X-Content-Type-Options": "nosniff",
    // Prevent clickjacking
    "X-Frame-Options": "DENY",
    // Enable XSS filter (legacy browsers)
    "X-XSS-Protection": "0",
    // Restrict referrer information
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Prevent DNS prefetching to external domains
    "X-DNS-Prefetch-Control": "off",
    // Strict permissions policy
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}
