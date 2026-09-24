/**
 * Shared rate limiting (spec §17.4): counters in PostgreSQL so a limit holds
 * across every replica (the in-memory limiter only sees one process). Used for
 * authentication-adjacent, search and export routes, per user and per IP.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { apiError } from "@/lib/api/response";
import { clientIp } from "@/lib/api/client-ip";

export interface SharedLimit {
  limit: number;
  windowSeconds: number;
}

export const SHARED_LIMITS = {
  /** Search: 60 per minute per user and per IP. */
  search: { limit: 60, windowSeconds: 60 },
  /** Exports and reports: 10 per 10 minutes per user and per IP (the daily cap is separate). */
  export: { limit: 10, windowSeconds: 600 },
} satisfies Record<string, SharedLimit>;

/** Atomically count one hit in the current fixed window; returns the count and the window start. */
export async function hit(key: string, windowSeconds: number, now = new Date()): Promise<{ count: number; windowStart: Date }> {
  const rows = await prisma.$queryRaw<Array<{ count: number; windowStart: Date }>>`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count", "updatedAt")
    VALUES (${key}, ${now}, 1, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."windowStart" <= ${now}::timestamp - make_interval(secs => ${windowSeconds}) THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" <= ${now}::timestamp - make_interval(secs => ${windowSeconds}) THEN ${now} ELSE "RateLimitBucket"."windowStart" END,
      "updatedAt" = ${now}
    RETURNING "count", "windowStart"`;
  return rows[0];
}

/**
 * 429 when the user or the IP is over the limit for this route. A database
 * error fails closed (503) for these routes: they are the expensive ones.
 */
export async function checkSharedRateLimit(request: NextRequest, name: keyof typeof SHARED_LIMITS, userId: string, now = new Date()): Promise<NextResponse | null> {
  const { limit, windowSeconds } = SHARED_LIMITS[name];
  const path = new URL(request.url).pathname;
  try {
    for (const key of [`u:${userId}:${name}`, `ip:${clientIp(request)}:${name}`]) {
      const { count, windowStart } = await hit(key, windowSeconds, now);
      if (count > limit) {
        const retryAfter = Math.max(1, Math.ceil((windowStart.getTime() + windowSeconds * 1000 - now.getTime()) / 1000));
        logger.security("Rate limit exceeded", { limiter: name, path, scope: key.startsWith("u:") ? "user" : "ip" });
        const res = apiError(`Rate limit exceeded. Try again in ${retryAfter} seconds.`, 429, "RATE_LIMITED");
        res.headers.set("Retry-After", String(retryAfter));
        return res;
      }
    }
    return null;
  } catch (error) {
    logger.error("Shared rate limit unavailable; refusing the request", { limiter: name, error: error instanceof Error ? error.message : String(error) });
    return apiError("Rate limiting unavailable; try again shortly.", 503, "RATE_LIMIT_UNAVAILABLE");
  }
}

/** Drop buckets idle for a day. */
export async function pruneRateLimitBuckets(now = new Date()): Promise<number> {
  const { count } = await prisma.rateLimitBucket.deleteMany({ where: { updatedAt: { lt: new Date(now.getTime() - 86_400_000) } } });
  return count;
}
