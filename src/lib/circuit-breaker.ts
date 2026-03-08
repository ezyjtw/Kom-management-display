/**
 * Circuit Breaker pattern for external service calls.
 *
 * Prevents cascading failures when downstream services (Komainu, Slack, Email, Jira)
 * are unhealthy. Transitions between three states:
 *
 *   CLOSED  → requests pass through normally
 *   OPEN    → requests are immediately rejected (fail fast)
 *   HALF_OPEN → a single probe request is allowed to test recovery
 *
 * Each breaker tracks failure counts and timestamps. When failures exceed the
 * threshold within the configured window, the breaker opens. After a cooldown,
 * it transitions to half-open, allowing one probe. If the probe succeeds, the
 * breaker closes; if it fails, it re-opens.
 *
 * Usage:
 *   const breaker = CircuitBreaker.for("komainu");
 *   const result = await breaker.execute(() => fetchPendingTransactions());
 */

import { logger } from "@/lib/logger";

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  /** Name of the downstream service (for logging and metrics). */
  name: string;
  /** Number of failures before the breaker opens. Default: 5 */
  failureThreshold?: number;
  /** Window in ms to count failures. Default: 60_000 (1 min) */
  failureWindowMs?: number;
  /** How long the breaker stays open before probing. Default: 30_000 (30s) */
  cooldownMs?: number;
  /** Timeout for each call in ms. Default: 15_000 (15s) */
  callTimeoutMs?: number;
  /** Called when state changes. */
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

interface FailureRecord {
  timestamp: number;
  error: string;
}

export class CircuitBreaker {
  private static instances = new Map<string, CircuitBreaker>();

  readonly name: string;
  private state: CircuitState = "closed";
  private failures: FailureRecord[] = [];
  private lastFailureTime = 0;
  private openedAt = 0;
  private successCount = 0;
  private totalCalls = 0;
  private totalFailures = 0;

  private readonly failureThreshold: number;
  private readonly failureWindowMs: number;
  private readonly cooldownMs: number;
  private readonly callTimeoutMs: number;
  private readonly onStateChange?: (from: CircuitState, to: CircuitState) => void;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.failureWindowMs = options.failureWindowMs ?? 60_000;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.callTimeoutMs = options.callTimeoutMs ?? 15_000;
    this.onStateChange = options.onStateChange;
  }

  /**
   * Get or create a named circuit breaker singleton.
   * Services share a breaker instance across the application.
   */
  static for(name: string, options?: Partial<CircuitBreakerOptions>): CircuitBreaker {
    if (!CircuitBreaker.instances.has(name)) {
      CircuitBreaker.instances.set(
        name,
        new CircuitBreaker({ name, ...options }),
      );
    }
    return CircuitBreaker.instances.get(name)!;
  }

  /** Reset all breakers (useful for testing). */
  static resetAll(): void {
    CircuitBreaker.instances.clear();
  }

  /** Get status of all registered breakers. */
  static getAllStatus(): Record<string, ReturnType<CircuitBreaker["getStatus"]>> {
    const result: Record<string, ReturnType<CircuitBreaker["getStatus"]>> = {};
    for (const [name, breaker] of CircuitBreaker.instances) {
      result[name] = breaker.getStatus();
    }
    return result;
  }

  /**
   * Execute a function through the circuit breaker.
   * Rejects immediately if the breaker is open (fail-fast).
   * Wraps the call with a timeout to prevent hanging.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalCalls++;

    if (this.state === "open") {
      if (this.shouldAttemptReset()) {
        this.transitionTo("half_open");
      } else {
        const elapsed = Date.now() - this.openedAt;
        const retryIn = Math.max(0, this.cooldownMs - elapsed);
        throw new CircuitBreakerError(
          this.name,
          `Circuit breaker OPEN for ${this.name}. Retry in ${Math.ceil(retryIn / 1000)}s.`,
        );
      }
    }

    try {
      const result = await this.withTimeout(fn);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /** Get the current status of this breaker. */
  getStatus() {
    const now = Date.now();
    const recentFailures = this.failures.filter(
      (f) => now - f.timestamp < this.failureWindowMs,
    );

    return {
      name: this.name,
      state: this.state,
      failureCount: recentFailures.length,
      failureThreshold: this.failureThreshold,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      successCount: this.successCount,
      lastFailure: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : null,
      openedAt: this.openedAt ? new Date(this.openedAt).toISOString() : null,
      cooldownMs: this.cooldownMs,
      recentErrors: recentFailures.slice(-3).map((f) => f.error),
    };
  }

  /** Manually reset the breaker to closed state. */
  reset(): void {
    this.failures = [];
    this.transitionTo("closed");
  }

  /** Get current state. */
  getState(): CircuitState {
    return this.state;
  }

  // ─── Internal ───

  private shouldAttemptReset(): boolean {
    return Date.now() - this.openedAt >= this.cooldownMs;
  }

  private onSuccess(): void {
    this.successCount++;
    if (this.state === "half_open") {
      logger.integration(this.name, "Circuit breaker probe succeeded, closing breaker", {
        totalCalls: this.totalCalls,
        totalFailures: this.totalFailures,
      });
      this.failures = [];
      this.transitionTo("closed");
    }
  }

  private onFailure(error: unknown): void {
    this.totalFailures++;
    const now = Date.now();
    const errorMsg = error instanceof Error ? error.message : String(error);

    this.failures.push({ timestamp: now, error: errorMsg });
    this.lastFailureTime = now;

    // Prune old failures outside the window
    this.failures = this.failures.filter(
      (f) => now - f.timestamp < this.failureWindowMs,
    );

    if (this.state === "half_open") {
      logger.integration(this.name, "Circuit breaker probe failed, re-opening", {
        error: errorMsg,
      });
      this.transitionTo("open");
      return;
    }

    if (this.failures.length >= this.failureThreshold) {
      logger.security(`Circuit breaker tripped for ${this.name}`, {
        failureCount: this.failures.length,
        threshold: this.failureThreshold,
        recentErrors: this.failures.slice(-3).map((f) => f.error),
      });
      this.transitionTo("open");
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    if (oldState === newState) return;

    this.state = newState;
    if (newState === "open") {
      this.openedAt = Date.now();
    }

    logger.integration(this.name, `Circuit breaker: ${oldState} → ${newState}`, {
      totalCalls: this.totalCalls,
      failureCount: this.failures.length,
    });

    this.onStateChange?.(oldState, newState);
  }

  private withTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${this.name} call timed out after ${this.callTimeoutMs}ms`));
      }, this.callTimeoutMs);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
}

/**
 * Custom error class for circuit breaker rejections.
 * Allows callers to distinguish between breaker rejections and actual call failures.
 */
export class CircuitBreakerError extends Error {
  readonly serviceName: string;

  constructor(serviceName: string, message: string) {
    super(message);
    this.name = "CircuitBreakerError";
    this.serviceName = serviceName;
  }
}

// ─── Pre-configured breakers for known services ───

/** Komainu custody API — longer cooldown for financial operations */
export function komainuBreaker(): CircuitBreaker {
  return CircuitBreaker.for("komainu", {
    failureThreshold: 3,
    cooldownMs: 60_000,
    callTimeoutMs: 20_000,
  });
}

/** Slack API — shorter cooldown, frequent retries acceptable */
export function slackBreaker(): CircuitBreaker {
  return CircuitBreaker.for("slack", {
    failureThreshold: 5,
    cooldownMs: 30_000,
    callTimeoutMs: 10_000,
  });
}

/** Email (SMTP) — moderate settings */
export function emailBreaker(): CircuitBreaker {
  return CircuitBreaker.for("email", {
    failureThreshold: 3,
    cooldownMs: 45_000,
    callTimeoutMs: 15_000,
  });
}

/** Jira API — moderate settings */
export function jiraBreaker(): CircuitBreaker {
  return CircuitBreaker.for("jira", {
    failureThreshold: 5,
    cooldownMs: 30_000,
    callTimeoutMs: 15_000,
  });
}
