/**
 * Client IP behind a known number of trusted reverse proxies (spec §17.4).
 * X-Forwarded-For is appended to by each proxy, so the address the trusted
 * edge saw is TRUSTED_PROXY_HOPS entries from the right; anything to its left
 * was supplied by the client and cannot be trusted. Default: 1 hop
 * (Application Gateway / Front Door). TODO(CONFIRM-PROXY-HOPS) with IT.
 */
export function clientIp(request: { headers: Headers }, hops = Number(process.env.TRUSTED_PROXY_HOPS ?? "1")): string {
  const chain = (request.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (chain.length && hops > 0) return chain[Math.max(0, chain.length - hops)];
  return request.headers.get("x-real-ip") ?? "unknown";
}
