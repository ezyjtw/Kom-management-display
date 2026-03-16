/**
 * Idempotency layer for critical mutations.
 *
 * Prevents duplicate processing when clients retry requests due to
 * network issues, timeouts, or user double-clicks. Clients include an
 * `Idempotency-Key` header; the server caches the response for that key
 * and returns it verbatim on subsequent requests.
 *
 * =====================================================================
 * MULTI-INSTANCE LIMITATION
 * =====================================================================
 * Storage is process-local (in-memory Map with TTL eviction). In
 * multi-instance deployments (e.g. Railway replicas, Kubernetes pods),
 * a retried request may hit a different instance that has no record of
 * the original — resulting in duplicate processing.
 *
 * For single-instance deployments this is safe. For multi-instance,
 * you MUST migrate to a shared store before scaling horizontally.
 *
 * TODO: Replace with Redis or Postgres-backed store for multi-instance
 * deployments. Migration path:
 *   - Redis: swap the `store` Map for Redis SET with NX + TTL
 *   - Postgres: create an idempotency_keys table with (key PK, response
 *     JSONB, status TEXT, created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ)
 * The public API (checkIdempotency, storeIdempotencyResponse,
 * releaseIdempotencyLock) stays the same.
 * =====================================================================
 *
 * Flow:
 *   1. Client sends POST/PUT with `Idempotency-Key: <uuid>` header
 *   2. Server checks cache for existing response
 *   3a. Cache hit  -> return cached response immediately (no re-processing)
 *   3b. Cache miss -> process request, store response, return it
 *   4. Entry is locked during processing to prevent concurrent duplicates
 *
 * Usage:
 *   const cached = checkIdempotency(request);
 *   if (cached) return cached;
 *   // ... process request ...
 *   storeIdempotencyResponse(key, response);
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";

interface IdempotencyEntry {
  /** The cached response body (serialized JSON). */
  responseBody: string;
  /** HTTP status code of the cached response. */
  statusCode: number;
  /** Timestamp when the entry was created (epoch ms). */
  createdAt: number;
  /** Whether the request is still being processed (lock). */
  processing: boolean;
}

/** TTL for cached responses: 24 hours. */
const ENTRY_TTL_MS = 24 * 60 * 60 * 1000;

/** In-memory idempotency store. */
const store = new Map<string, IdempotencyEntry>();

// Evict expired entries every 10 minutes to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  let evicted = 0;
  for (const [key, entry] of store) {
    if (now - entry.createdAt > ENTRY_TTL_MS) {
      store.delete(key);
      evicted++;
    }
  }
  if (evicted > 0) {
    logger.debug(`Idempotency store: evicted ${evicted} expired entries, ${store.size} remaining`);
  }
}, 10 * 60 * 1000);

/**
 * Extract the idempotency key from a request.
 * Returns null if no key is provided.
 */
export function getIdempotencyKey(request: NextRequest): string | null {
  return request.headers.get("idempotency-key");
}

/**
 * Check if a request has already been processed.
 *
 * Returns:
 *   - A cached NextResponse if the key was seen before
 *   - A 409 response if the key is currently being processed (concurrent duplicate)
 *   - null if this is a new request (caller should proceed)
 */
export function checkIdempotency(request: NextRequest): NextResponse | null {
  const key = getIdempotencyKey(request);
  if (!key) return null; // No idempotency key — process normally

  const entry = store.get(key);

  if (!entry) {
    // New key — mark as processing (lock)
    store.set(key, {
      responseBody: "",
      statusCode: 0,
      createdAt: Date.now(),
      processing: true,
    });
    logger.debug("Idempotency: new entry created", { key, storeSize: store.size });
    return null;
  }

  if (entry.processing) {
    // Another request with the same key is still being processed
    logger.warn("Idempotency: concurrent duplicate request", { key });
    return NextResponse.json(
      {
        success: false,
        error: "A request with this idempotency key is currently being processed",
        code: "IDEMPOTENCY_CONFLICT",
      },
      { status: 409 },
    );
  }

  // Cache hit — return the stored response
  logger.info("Idempotency: returning cached response", { key });
  return new NextResponse(entry.responseBody, {
    status: entry.statusCode,
    headers: {
      "Content-Type": "application/json",
      "X-Idempotency-Replayed": "true",
    },
  });
}

/**
 * Store a response for an idempotency key.
 * Call this after successfully processing a request.
 */
export async function storeIdempotencyResponse(
  request: NextRequest,
  response: NextResponse,
): Promise<void> {
  const key = getIdempotencyKey(request);
  if (!key) return;

  try {
    const body = await response.clone().text();
    store.set(key, {
      responseBody: body,
      statusCode: response.status,
      createdAt: Date.now(),
      processing: false,
    });
  } catch (error) {
    // If we can't cache, release the lock
    store.delete(key);
    logger.warn("Idempotency: failed to cache response", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Release an idempotency lock (call on error to allow retry).
 */
export function releaseIdempotencyLock(request: NextRequest): void {
  const key = getIdempotencyKey(request);
  if (!key) return;

  const entry = store.get(key);
  if (entry?.processing) {
    store.delete(key);
  }
}

/**
 * Get idempotency store stats (for diagnostics/health checks).
 */
export function getIdempotencyStats(): {
  totalEntries: number;
  processingCount: number;
  oldestEntryAge: number | null;
} {
  let processingCount = 0;
  let oldestCreatedAt = Infinity;

  for (const entry of store.values()) {
    if (entry.processing) processingCount++;
    if (entry.createdAt < oldestCreatedAt) oldestCreatedAt = entry.createdAt;
  }

  return {
    totalEntries: store.size,
    processingCount,
    oldestEntryAge: store.size > 0 ? Date.now() - oldestCreatedAt : null,
  };
}
