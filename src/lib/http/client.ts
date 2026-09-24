/**
 * The only way server code may make outbound HTTP requests (spec §6.4).
 */

import { getAllowedHosts } from "@/lib/http/allowed-hosts";
import { logger } from "@/lib/logger";
import { recordIntegrationAuthFailure } from "@/modules/security/record";

export class EgressDeniedError extends Error {
  constructor(readonly host: string) {
    super(`Outbound request to ${host} blocked: host is not on the egress allowlist`);
    this.name = "EgressDeniedError";
  }
}

function toUrl(input: string | URL | Request): URL {
  if (input instanceof URL) return input;
  return new URL(typeof input === "string" ? input : input.url);
}

/** Throws EgressDeniedError unless the URL is http(s) to an allowlisted host. */
export function assertEgressAllowed(input: string | URL | Request, allowed = getAllowedHosts()): URL {
  const url = toUrl(input);
  const host = url.hostname.toLowerCase();
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !allowed.has(host)) {
    logger.security("Egress blocked", { host });
    throw new EgressDeniedError(host);
  }
  return url;
}

/**
 * Drop-in replacement for fetch() that enforces the egress allowlist. A 401 or
 * 403 from a connector is audit-logged (repeats raise ALR-SEC-05, spec §17.7).
 */
export const httpFetch: typeof fetch = async (input, init) => {
  const url = assertEgressAllowed(input);
  const res = await fetch(input, init);
  if (res.status === 401 || res.status === 403) {
    void recordIntegrationAuthFailure({ host: url.hostname.toLowerCase(), status: res.status });
  }
  return res;
};

export interface RetryOptions {
  /** Total attempts including the first (default 4). */
  maxAttempts?: number;
  /** Base backoff in ms, doubled per attempt (default 500). */
  baseDelayMs?: number;
  /** Cap per wait in ms (default 30s). */
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Called with the parsed remaining-quota header whenever one is present. */
  onRateLimit?: (remaining: number) => void;
}

const RETRYABLE = new Set([429, 502, 503, 504]);
const REMAINING_HEADERS = ["x-ratelimit-remaining", "x-rate-limit-remaining", "ratelimit-remaining"];

export function rateLimitRemaining(res: Response): number | undefined {
  for (const h of REMAINING_HEADERS) {
    const v = res.headers.get(h);
    if (v !== null && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

function retryAfterMs(res: Response): number | undefined {
  const v = res.headers.get("retry-after");
  if (!v) return undefined;
  const secs = Number(v);
  if (Number.isFinite(secs)) return secs * 1000;
  const date = Date.parse(v);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/**
 * httpFetch with exponential backoff on 429 and transient 5xx (spec §8.1).
 * Honours Retry-After. Only safe for idempotent requests — callers must not
 * use it for writes that could double-apply.
 */
export async function httpFetchWithRetry(
  input: string | URL,
  init: RequestInit | undefined,
  opts: RetryOptions = {},
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const base = opts.baseDelayMs ?? 500;
  const cap = opts.maxDelayMs ?? 30_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  for (let attempt = 1; ; attempt++) {
    const res = await httpFetch(input, init);
    const remaining = rateLimitRemaining(res);
    if (remaining !== undefined) opts.onRateLimit?.(remaining);
    if (!RETRYABLE.has(res.status) || attempt >= maxAttempts) return res;
    const wait = Math.min(cap, retryAfterMs(res) ?? base * 2 ** (attempt - 1));
    logger.warn("Retrying outbound request", { status: res.status, attempt, waitMs: wait });
    await sleep(wait);
  }
}