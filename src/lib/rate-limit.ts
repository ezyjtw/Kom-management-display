/**
 * In-memory rate limiter for login throttling and API abuse prevention.
 * Uses a sliding window approach.
 *
 * For production at scale, replace with Redis-backed rate limiting.
 */

interface RateLimitEntry {
  attempts: number;
  windowStart: number;
  lockedUntil: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.windowStart + 15 * 60 * 1000 && now > entry.lockedUntil) {
      store.delete(key);
    }
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
