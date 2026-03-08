/**
 * Feature flag system for gradual rollout of new features.
 *
 * Flags are stored in the database and cached in-memory for 60 seconds.
 * Supports role-based and team-based targeting, plus percentage rollout.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

interface FlagCache {
  flags: Map<string, FlagValue>;
  expiresAt: number;
}

interface FlagValue {
  enabled: boolean;
  roles: string[];
  teams: string[];
  percentage: number;
}

let cache: FlagCache | null = null;
const CACHE_TTL_MS = 60_000; // 60 seconds

/**
 * Load all flags from the database and cache them.
 */
async function loadFlags(): Promise<Map<string, FlagValue>> {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.flags;
  }

  try {
    const flags = await prisma.featureFlag.findMany();
    const map = new Map<string, FlagValue>();

    for (const flag of flags) {
      map.set(flag.key, {
        enabled: flag.enabled,
        roles: safeParseJsonArray(flag.roles),
        teams: safeParseJsonArray(flag.teams),
        percentage: flag.percentage,
      });
    }

    cache = { flags: map, expiresAt: Date.now() + CACHE_TTL_MS };
    return map;
  } catch (error) {
    logger.error("Failed to load feature flags", {
      error: error instanceof Error ? error.message : String(error),
    });
    return cache?.flags ?? new Map();
  }
}

function safeParseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Check if a feature flag is enabled for a given user context.
 */
export async function isFeatureEnabled(
  key: string,
  context?: { role?: string; team?: string; userId?: string },
): Promise<boolean> {
  const flags = await loadFlags();
  const flag = flags.get(key);

  if (!flag || !flag.enabled) return false;

  // Check role targeting
  if (flag.roles.length > 0 && context?.role) {
    if (!flag.roles.includes(context.role)) return false;
  }

  // Check team targeting
  if (flag.teams.length > 0 && context?.team) {
    if (!flag.teams.includes(context.team)) return false;
  }

  // Check percentage rollout
  if (flag.percentage < 100 && context?.userId) {
    const hash = simpleHash(context.userId + key);
    if (hash % 100 >= flag.percentage) return false;
  }

  return true;
}

/**
 * Get all feature flags with their current state.
 */
export async function getAllFlags(): Promise<Array<{
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  roles: string[];
  teams: string[];
  percentage: number;
}>> {
  const flags = await prisma.featureFlag.findMany({
    orderBy: { key: "asc" },
  });

  return flags.map((f) => ({
    key: f.key,
    name: f.name,
    description: f.description,
    enabled: f.enabled,
    roles: safeParseJsonArray(f.roles),
    teams: safeParseJsonArray(f.teams),
    percentage: f.percentage,
  }));
}

/**
 * Invalidate the flag cache (call after mutations).
 */
export function invalidateFlagCache(): void {
  cache = null;
}

/**
 * Simple deterministic hash for percentage rollout.
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit int
  }
  return Math.abs(hash);
}
