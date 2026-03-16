/**
 * Slack API rate limiter — token bucket algorithm.
 *
 * Slack Tier 3 APIs allow 50 requests per minute. We use 45 tokens
 * with a 5-token buffer to avoid hitting the limit.
 */

let tokens = 45;
let lastRefill = Date.now();

export async function acquireSlackToken(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRefill;
  if (elapsed >= 60_000) {
    tokens = 45;
    lastRefill = now;
  }
  if (tokens > 0) {
    tokens--;
    return;
  }
  const waitMs = 60_000 - elapsed;
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  tokens = 44;
  lastRefill = Date.now();
}

/**
 * Reset the rate limiter state (useful for testing).
 */
export function resetRateLimiter(): void {
  tokens = 45;
  lastRefill = Date.now();
}
