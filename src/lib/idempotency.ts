/**
 * At-most-once mutations (review remediation). Runs in the middleware for every
 * authenticated POST/PUT/PATCH/DELETE, so every route — including future ones —
 * is covered without per-route code.
 *
 * - With an `Idempotency-Key` header (8–128 visible characters), a request is
 *   accepted at most once per user and key for 24 hours. Reusing the key with a
 *   different request body is refused (422).
 * - Without one, an identical request (same user, method, path and body)
 *   within DUPLICATE_WINDOW_SECONDS is refused as a double submission
 *   (409 DUPLICATE_REQUEST): double clicks, client retries after a timeout.
 *
 * A refused duplicate gets 409, not a replay of the first response: the
 * middleware cannot capture route responses, so the guarantee is that the
 * effect happens at most once. The caller re-reads the state.
 *
 * Keys are claimed atomically in PostgreSQL (IdempotencyKey table),
 * so the guard holds across replicas. If the store cannot be reached the
 * request continues (logged): the mutation itself needs the same database.
 */
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export const IDEMPOTENCY_HEADER = "idempotency-key";
export const DUPLICATE_WINDOW_SECONDS = 10;
export const EXPLICIT_KEY_TTL_SECONDS = 24 * 3600;
const MAX_HASHED_BODY_BYTES = 1_000_000;
const KEY_PATTERN = /^[\x21-\x7e]{8,128}$/;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Paths with their own replay protection or no user session. */
export const IDEMPOTENCY_EXEMPT_PATHS = ["/api/auth/", "/api/webhooks/", "/api/alerts/generate"];

export type ClaimResult = "claimed" | "duplicate" | "mismatch";

/**
 * Atomically claim a key. Returns "claimed" for the first request, "duplicate"
 * for a repeat inside the window, "mismatch" when an explicit key is reused
 * for a different request.
 */
export async function claimKey(key: string, requestHash: string, ttlSeconds: number, now = new Date()): Promise<ClaimResult> {
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  // Insert, or take over an expired key, in one statement; returns a row only if we own the key now.
  const claimed = await prisma.$queryRaw<Array<{ key: string }>>`
    INSERT INTO "IdempotencyKey" ("key", "requestHash", "createdAt", "expiresAt")
    VALUES (${key}, ${requestHash}, ${now}, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE SET "requestHash" = EXCLUDED."requestHash", "createdAt" = EXCLUDED."createdAt", "expiresAt" = EXCLUDED."expiresAt"
      WHERE "IdempotencyKey"."expiresAt" <= ${now}
    RETURNING "key"`;
  if (claimed.length) return "claimed";
  const existing = await prisma.idempotencyKey.findUnique({ where: { key }, select: { requestHash: true } });
  return existing && existing.requestHash !== requestHash ? "mismatch" : "duplicate";
}

function json(status: number, error: string, code: string, retryAfter?: number): NextResponse {
  const res = NextResponse.json({ success: false, error, code }, { status });
  if (retryAfter) res.headers.set("Retry-After", String(retryAfter));
  return res;
}

/** Middleware guard. Returns a refusal response, or null to continue. */
export async function duplicateMutation(req: NextRequest, path: string, userId: string | null): Promise<NextResponse | null> {
  if (!userId || IDEMPOTENCY_EXEMPT_PATHS.some((p) => path.startsWith(p))) return null;
  const explicit = req.headers.get(IDEMPOTENCY_HEADER);
  if (explicit !== null && !KEY_PATTERN.test(explicit)) {
    return json(400, "Idempotency-Key must be 8-128 visible ASCII characters", "IDEMPOTENCY_KEY_INVALID");
  }
  try {
    const raw = await req.clone().text();
    const body = raw.length > MAX_HASHED_BODY_BYTES ? raw.slice(0, MAX_HASHED_BODY_BYTES) : raw;
    const requestHash = sha(`${req.method} ${path}\n${body}`);
    if (explicit) {
      const result = await claimKey(`k:${sha(`${userId}\n${explicit}`)}`, requestHash, EXPLICIT_KEY_TTL_SECONDS);
      if (result === "mismatch") return json(422, "This Idempotency-Key was already used for a different request", "IDEMPOTENCY_KEY_REUSED");
      if (result === "duplicate") return json(409, "This request was already received (same Idempotency-Key). Reload to see its result.", "DUPLICATE_REQUEST");
      return null;
    }
    const result = await claimKey(`w:${sha(`${userId}\n${requestHash}`)}`, requestHash, DUPLICATE_WINDOW_SECONDS);
    if (result !== "claimed") {
      return json(409, "The same request was just submitted. Reload to see its result, or retry in a few seconds.", "DUPLICATE_REQUEST", DUPLICATE_WINDOW_SECONDS);
    }
    return null;
  } catch (error) {
    logger.warn("Idempotency store unavailable; request not deduplicated", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** Drop expired keys (cleanup job). */
export async function pruneIdempotencyKeys(now = new Date()): Promise<number> {
  const { count } = await prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } });
  return count;
}

/** For the deep health check. */
export async function getIdempotencyStats(now = new Date()): Promise<{ activeKeys: number }> {
  return { activeKeys: await prisma.idempotencyKey.count({ where: { expiresAt: { gt: now } } }) };
}
