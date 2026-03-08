/**
 * Application metrics collection.
 *
 * Tracks key operational metrics in memory for exposure via /api/metrics.
 * Provides counters, gauges, and histograms for monitoring application health.
 *
 * Metric types:
 *   - Counter: Monotonically increasing value (requests, errors)
 *   - Gauge: Current point-in-time value (active connections, queue depth)
 *   - Histogram: Distribution of values (response times, payload sizes)
 *
 * Designed for pull-based monitoring (Prometheus-style scraping) or
 * periodic push to a metrics backend.
 *
 * Usage:
 *   metrics.incrementCounter("api_requests_total", { method: "GET", path: "/api/health" });
 *   metrics.setGauge("active_sse_clients", 42);
 *   metrics.recordHistogram("api_response_time_ms", 123, { path: "/api/health" });
 *
 *   const snapshot = metrics.getSnapshot();
 */

interface CounterEntry {
  type: "counter";
  value: number;
  labels: Record<string, string>;
  lastUpdated: number;
}

interface GaugeEntry {
  type: "gauge";
  value: number;
  labels: Record<string, string>;
  lastUpdated: number;
}

interface HistogramEntry {
  type: "histogram";
  count: number;
  sum: number;
  min: number;
  max: number;
  buckets: Map<number, number>; // upper bound → count
  labels: Record<string, string>;
  lastUpdated: number;
}

type MetricEntry = CounterEntry | GaugeEntry | HistogramEntry;

/** Default histogram bucket boundaries (milliseconds for response times). */
const DEFAULT_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

class MetricsCollector {
  private store = new Map<string, MetricEntry>();

  /** Generate a unique key for a metric with specific labels. */
  private key(name: string, labels: Record<string, string> = {}): string {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  /**
   * Increment a counter by the given amount (default: 1).
   */
  incrementCounter(name: string, labels: Record<string, string> = {}, amount = 1): void {
    const k = this.key(name, labels);
    const existing = this.store.get(k);

    if (existing && existing.type === "counter") {
      existing.value += amount;
      existing.lastUpdated = Date.now();
    } else {
      this.store.set(k, {
        type: "counter",
        value: amount,
        labels,
        lastUpdated: Date.now(),
      });
    }
  }

  /**
   * Set a gauge to an absolute value.
   */
  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const k = this.key(name, labels);
    this.store.set(k, {
      type: "gauge",
      value,
      labels,
      lastUpdated: Date.now(),
    });
  }

  /**
   * Record a value in a histogram.
   */
  recordHistogram(
    name: string,
    value: number,
    labels: Record<string, string> = {},
    buckets = DEFAULT_BUCKETS,
  ): void {
    const k = this.key(name, labels);
    const existing = this.store.get(k);

    if (existing && existing.type === "histogram") {
      existing.count++;
      existing.sum += value;
      existing.min = Math.min(existing.min, value);
      existing.max = Math.max(existing.max, value);
      existing.lastUpdated = Date.now();

      for (const bound of buckets) {
        if (value <= bound) {
          existing.buckets.set(bound, (existing.buckets.get(bound) ?? 0) + 1);
        }
      }
    } else {
      const bucketMap = new Map<number, number>();
      for (const bound of buckets) {
        bucketMap.set(bound, value <= bound ? 1 : 0);
      }

      this.store.set(k, {
        type: "histogram",
        count: 1,
        sum: value,
        min: value,
        max: value,
        buckets: bucketMap,
        labels,
        lastUpdated: Date.now(),
      });
    }
  }

  /**
   * Get a snapshot of all metrics in a serializable format.
   */
  getSnapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, entry] of this.store) {
      if (entry.type === "histogram") {
        const bucketObj: Record<string, number> = {};
        for (const [bound, count] of entry.buckets) {
          bucketObj[`le_${bound}`] = count;
        }

        result[key] = {
          type: entry.type,
          count: entry.count,
          sum: entry.sum,
          min: entry.min,
          max: entry.max,
          avg: entry.count > 0 ? Math.round(entry.sum / entry.count) : 0,
          buckets: bucketObj,
          labels: entry.labels,
          lastUpdated: new Date(entry.lastUpdated).toISOString(),
        };
      } else {
        result[key] = {
          type: entry.type,
          value: entry.value,
          labels: entry.labels,
          lastUpdated: new Date(entry.lastUpdated).toISOString(),
        };
      }
    }

    return result;
  }

  /**
   * Get a single metric value by name and labels.
   */
  getValue(name: string, labels: Record<string, string> = {}): number | null {
    const entry = this.store.get(this.key(name, labels));
    if (!entry) return null;
    if (entry.type === "histogram") return entry.count;
    return entry.value;
  }

  /**
   * Reset all metrics (useful for testing).
   */
  reset(): void {
    this.store.clear();
  }

  /**
   * Get the total number of tracked metrics.
   */
  get size(): number {
    return this.store.size;
  }
}

/** Singleton metrics collector instance. */
export const metrics = new MetricsCollector();

// ─── Convenience helpers for common metrics ───

/** Record an API request. */
export function recordApiRequest(method: string, path: string, statusCode: number, durationMs: number): void {
  metrics.incrementCounter("api_requests_total", { method, path });
  metrics.incrementCounter("api_responses_total", { method, path, status: String(statusCode) });
  metrics.recordHistogram("api_response_time_ms", durationMs, { method, path });

  if (statusCode >= 500) {
    metrics.incrementCounter("api_server_errors_total", { method, path });
  } else if (statusCode >= 400) {
    metrics.incrementCounter("api_client_errors_total", { method, path });
  }
}

/** Record a database query. */
export function recordDbQuery(operation: string, durationMs: number): void {
  metrics.incrementCounter("db_queries_total", { operation });
  metrics.recordHistogram("db_query_duration_ms", durationMs, { operation });
}

/** Record a circuit breaker event. */
export function recordCircuitBreakerEvent(service: string, event: "success" | "failure" | "rejected"): void {
  metrics.incrementCounter("circuit_breaker_events_total", { service, event });
}

/** Record a rate limit event. */
export function recordRateLimitEvent(path: string): void {
  metrics.incrementCounter("rate_limit_rejections_total", { path });
}

/** Record an authentication event. */
export function recordAuthEvent(event: "login_success" | "login_failure" | "session_expired" | "rate_limited"): void {
  metrics.incrementCounter("auth_events_total", { event });
}
