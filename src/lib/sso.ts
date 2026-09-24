/**
 * Entra ID (Azure AD) single sign-on rules. Pure functions — no DB access.
 */

import { z } from "zod";
import type { Role } from "@/modules/auth/types";
import { deploymentTier } from "@/lib/deployment-tier";

const ROLE_PRECEDENCE: Role[] = ["admin", "lead", "employee", "auditor"];

const roleGroupMapSchema = z.record(z.string().min(1), z.enum(["admin", "lead", "employee", "auditor"]));

export type RoleGroupMap = Record<string, Role>;

/** Parse ROLE_GROUP_MAP. Invalid or empty config maps nobody, so every SSO login is denied. */
export function parseRoleGroupMap(raw: string | undefined): RoleGroupMap {
  if (!raw?.trim()) return {};
  try {
    const parsed = roleGroupMapSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Highest-privilege role among the user's mapped groups, or null if none map. */
export function resolveRoleFromGroups(groups: readonly string[], map: RoleGroupMap): Role | null {
  const roles = new Set(groups.map((g) => map[g]).filter((r): r is Role => Boolean(r)));
  return ROLE_PRECEDENCE.find((r) => roles.has(r)) ?? null;
}

export interface EntraProfileClaims {
  email?: string;
  preferred_username?: string;
  upn?: string;
  groups?: unknown;
  _claim_names?: unknown;
}

export function emailFromClaims(claims: EntraProfileClaims): string | null {
  const email = claims.email || claims.preferred_username || claims.upn;
  return email ? email.trim().toLowerCase() : null;
}

/**
 * Group object IDs from the ID token. Returns null on group overage (Entra
 * omits `groups` and sets `_claim_names` when a user is in too many groups);
 * we deny rather than guess.
 */
export function groupsFromClaims(claims: EntraProfileClaims): string[] | null {
  if (claims._claim_names && typeof claims._claim_names === "object" && "groups" in claims._claim_names) {
    return null;
  }
  if (!Array.isArray(claims.groups)) return [];
  return claims.groups.filter((g): g is string => typeof g === "string");
}

export type SsoDecision =
  | { allowed: true; email: string; role: Role }
  | { allowed: false; email: string | null; reason: "no_email" | "group_overage" | "no_mapped_group" | "no_employee" };

/** Decide an SSO login given the claims, the role map and whether an Employee matches the email. */
export async function decideSsoLogin(
  claims: EntraProfileClaims,
  map: RoleGroupMap,
  hasEmployee: (email: string) => Promise<boolean>,
): Promise<SsoDecision> {
  const email = emailFromClaims(claims);
  if (!email) return { allowed: false, email: null, reason: "no_email" };

  const groups = groupsFromClaims(claims);
  if (groups === null) return { allowed: false, email, reason: "group_overage" };

  const role = resolveRoleFromGroups(groups, map);
  if (!role) return { allowed: false, email, reason: "no_mapped_group" };

  if (!(await hasEmployee(email))) return { allowed: false, email, reason: "no_employee" };

  return { allowed: true, email, role };
}

/** Local username/password login: never in production, and only with ALLOW_LOCAL_LOGIN=true. */
export function isLocalLoginAllowed(nodeEnv: string | undefined, allowLocalLogin: string | undefined, komEnvironment?: string): boolean {
  // Never in the production tier; in demo or development only when explicitly switched on.
  return deploymentTier({ NODE_ENV: nodeEnv, KOM_ENVIRONMENT: komEnvironment }) !== "production" && allowLocalLogin === "true";
}

export function isAzureAdConfigured(e: {
  AZURE_AD_TENANT_ID?: string;
  AZURE_AD_CLIENT_ID?: string;
  AZURE_AD_CLIENT_SECRET?: string;
}): boolean {
  return Boolean(e.AZURE_AD_TENANT_ID && e.AZURE_AD_CLIENT_ID && e.AZURE_AD_CLIENT_SECRET);
}
