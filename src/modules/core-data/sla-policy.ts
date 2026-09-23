import type { SlaPolicy } from "@prisma/client";

type Targets = Pick<SlaPolicy, "ownershipMins" | "firstRespMins" | "resolveMins" | "resolveRule">;

/** A policy "has targets" once at least one clock is set. Until then SLA alerts and attainment stay off. */
export function hasTargets(p: Targets): boolean {
  return p.ownershipMins !== null || p.firstRespMins !== null || p.resolveMins !== null || p.resolveRule !== null;
}
