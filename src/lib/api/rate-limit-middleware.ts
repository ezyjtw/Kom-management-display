/**
 * API rate limiting middleware.
 *
 * Provides configurable per-route rate limiting using a sliding window.
 * Uses IP + user ID as the rate limit key for authenticated endpoints.
 *
 * For production at scale, replace the in-memory store with Redis.
 */
import { NextRequest, NextResponse } from "next/server";
import { apiError } from "./response";

interface RateLimitWindow {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitWindow>();

// Evict expired entries every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, window] of store) {
    if (now > window.resetAt) {
      store.delete(key);
    }
  }
}, 2 * 60 * 1000);

export interface RateLimitOptions {
  /** Maximum requests per window. Default: 60 */
  limit?: number;
  /** Window duration in seconds. Default: 60 */
  windowSeconds?: number;
}

/** Presets for common patterns */
export const RATE_LIMIT_PRESETS = {
  /** Standard read endpoints: 120 req/min */
  read: { limit: 120, windowSeconds: 60 } as RateLimitOptions,
  /** Mutation endpoints: 30 req/min */
  mutation: { limit: 30, windowSeconds: 60 } as RateLimitOptions,
  /** Sensitive operations (config changes, exports): 10 req/min */
  sensitive: { limit: 10, windowSeconds: 60 } as RateLimitOptions,
  /** AI/expensive operations: 5 req/min */
  expensive: { limit: 5, windowSeconds: 60 } as RateLimitOptions,
};

/**
 * Extract a rate limit key from a request.
 * Uses X-Forwarded-For or falls back to a generic key.
 */
function getClientKey(request: NextRequest, userId?: string): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
  const path = new URL(request.url).pathname;
  return userId ? `${userId}:${path}` : `${ip}:${path}`;
}

/**
 * Check rate limit and return headers or a 429 response.
 *
 * Usage in a route handler:
 * ```ts
 * const limited = checkRateLimit(request, { limit: 30, windowSeconds: 60 });
 * if (limited) return limited;
 * ```
 */
export function checkRateLimit(
  request: NextRequest,
  options: RateLimitOptions = {},
  userId?: string,
): NextResponse | null {
  const limit = options.limit ?? 60;
  const windowMs = (options.windowSeconds ?? 60) * 1000;
  const now = Date.now();
  const key = getClientKey(request, userId);

  const window = store.get(key);

  if (!window || now > window.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  window.count++;

  if (window.count > limit) {
    const retryAfter = Math.ceil((window.resetAt - now) / 1000);
    const response = apiError(
      `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
      429,
      "RATE_LIMITED",
    );
    response.headers.set("Retry-After", String(retryAfter));
    response.headers.set("X-RateLimit-Limit", String(limit));
    response.headers.set("X-RateLimit-Remaining", "0");
    response.headers.set("X-RateLimit-Reset", String(Math.ceil(window.resetAt / 1000)));
    return response;
  }

  return null;
}
