/**
 * Egress allowlist (spec §6.4). Every outbound HTTP request goes through
 * src/lib/http/client.ts, which refuses hosts not returned here.
 */

import { env } from "@/lib/env";

export const DEFAULT_ATLASSIAN_HOST = "example.atlassian.net";

/** Always permitted, independent of configuration. */
export const STATIC_ALLOWED_HOSTS = Object.freeze([
  "api.atlassian.com",
  "slack.com",
  "graph.microsoft.com",
  "login.microsoftonline.com",
]);

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export interface EgressConfig {
  CUSTODY_API_BASE_URL?: string;
  ATLASSIAN_BASE_URL?: string;
  EGRESS_EXTRA_HOSTS?: string;
}

/**
 * custody API host, the Atlassian site, the static hosts above, plus any
 * comma-separated EGRESS_EXTRA_HOSTS (for example when an optional module
 * such as the market ticker is switched on).
 */
export function buildAllowedHosts(cfg: EgressConfig): ReadonlySet<string> {
  const hosts = new Set<string>(STATIC_ALLOWED_HOSTS);
  const custody = hostOf(cfg.CUSTODY_API_BASE_URL);
  if (custody) hosts.add(custody);
  hosts.add(hostOf(cfg.ATLASSIAN_BASE_URL) ?? DEFAULT_ATLASSIAN_HOST);
  for (const extra of (cfg.EGRESS_EXTRA_HOSTS ?? "").split(",")) {
    const h = hostOf(extra.trim());
    if (h) hosts.add(h);
  }
  return hosts;
}

export function getAllowedHosts(): ReadonlySet<string> {
  return buildAllowedHosts({
    CUSTODY_API_BASE_URL: env("CUSTODY_API_BASE_URL"),
    ATLASSIAN_BASE_URL: env("ATLASSIAN_BASE_URL"),
    EGRESS_EXTRA_HOSTS: env("EGRESS_EXTRA_HOSTS"),
  });
}
