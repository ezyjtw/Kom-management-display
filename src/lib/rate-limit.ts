/**
 * Rate limiter for login throttling and API abuse prevention.
 * Uses a sliding window approach with in-memory storage.
 *
 * =====================================================================
 * MULTI-INSTANCE LIMITATION
 * =====================================================================
 * This store is process-local (in-memory Map). In multi-instance
 * deployments (e.g. Railway with replicas, Kubernetes pods), each
 * instance maintains its own independent rate-limit map. A brute-force
 * attacker hitting different instances gets N x maxAttempts attempts
 * before any single instance triggers lockout.
 *
 * MITIGATION: When a lockout is triggered, an audit log entry is
 * persisted to the database so that admins can observe lockout events
 * across all instances from the Admin Panel.
 *
 * TODO: Replace with Redis-backed rate limiting for true multi-instance
 * enforcement. Migration path: swap the `store` Map for a Redis hash
 * with TTL-based expiry. The public API (checkLoginRateLimit,
 * resetLoginRateLimit) stays the same.
 * =====================================================================
 */

import { logger } from "@/lib/logger";

interface RateLimitEntry {
  attempts: number;
  windowStart: number;
  lockedUntil: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  let evicted = 0;
  for (const [key, entry] of store) {
    if (now > entry.windowStart + 15 * 60 * 1000 && now > entry.lockedUntil) {
      store.delete(key);
      evicted++;
    }
  }
  if (evicted > 0) {
    logger.debug(`Rate-limit store: evicted ${evicted} expired entries, ${store.size} remaining`);
  }
}, 5 * 60 * 1000);

interface RateLimitConfig {
  maxAttempts: number;    // Max attempts before lockout
  windowMs: number;       // Window duration in ms
  lockoutMs: number;      // Lockout duration in ms
}

const LOGIN_CONFIG: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,   // 15-minute window
  lockoutMs: 15 * 60 * 1000,  // 15-minute lockout
};

/**
 * Check if a login attempt is allowed for the given identifier (email or IP).
 * Returns { allowed: true } or { allowed: false, retryAfterMs }.
 *
 * When a lockout is triggered, an audit log entry is written to the database
 * so admins can see lockout events across all instances.
 */
export function checkLoginRateLimit(identifier: string): {
  allowed: boolean;
  retryAfterMs?: number;
  remainingAttempts?: number;
} {
  const now = Date.now();
  const entry = store.get(identifier);

  if (!entry) {
    store.set(identifier, { attempts: 1, windowStart: now, lockedUntil: 0 });
    return { allowed: true, remainingAttempts: LOGIN_CONFIG.maxAttempts - 1 };
  }

  // Check lockout
  if (now < entry.lockedUntil) {
    return { allowed: false, retryAfterMs: entry.lockedUntil - now };
  }

  // Reset window if expired
  if (now > entry.windowStart + LOGIN_CONFIG.windowMs) {
    entry.attempts = 1;
    entry.windowStart = now;
    entry.lockedUntil = 0;
    return { allowed: true, remainingAttempts: LOGIN_CONFIG.maxAttempts - 1 };
  }

  entry.attempts++;

  if (entry.attempts > LOGIN_CONFIG.maxAttempts) {
    entry.lockedUntil = now + LOGIN_CONFIG.lockoutMs;

    // Persist lockout to audit log for cross-instance visibility
    const maskedId = identifier.length > 4
      ? identifier.substring(0, 4) + "***"
      : "***";
    logger.audit(
      "login_rate_limit_lockout",
      "rate_limit",
      maskedId,
      "system",
      {
        attempts: entry.attempts,
        lockoutMs: LOGIN_CONFIG.lockoutMs,
        windowMs: LOGIN_CONFIG.windowMs,
        note: "In-memory rate limit — lockout may not be enforced across instances",
      },
    );

    return { allowed: false, retryAfterMs: LOGIN_CONFIG.lockoutMs };
  }

  return { allowed: true, remainingAttempts: LOGIN_CONFIG.maxAttempts - entry.attempts };
}

/**
 * Reset rate limit for an identifier (e.g., after successful login).
 */
export function resetLoginRateLimit(identifier: string): void {
  store.delete(identifier);
}
