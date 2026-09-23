/**
 * The only way server code may make outbound HTTP requests (spec §6.4).
 */

import { getAllowedHosts } from "@/lib/http/allowed-hosts";
import { logger } from "@/lib/logger";

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

/** Drop-in replacement for fetch() that enforces the egress allowlist. */
export const httpFetch: typeof fetch = (input, init) => {
  assertEgressAllowed(input);
  return fetch(input, init);
};
