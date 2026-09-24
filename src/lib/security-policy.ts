/**
 * Security policy shared by the Edge middleware, the client fetch shim and
 * tests (spec §17.4). Edge-safe: no Node imports.
 */

export const CSRF_COOKIE = "kom.csrf";
/** On HTTPS the CSRF cookie is host-scoped with the __Host- prefix. */
export const csrfCookieName = (secure: boolean) => (secure ? `__Host-${CSRF_COOKIE}` : CSRF_COOKIE);
export const CSRF_HEADER = "x-csrf-token";

/** Paths whose POSTs come from outside the browser session and are verified another way. */
export const CSRF_EXEMPT_PATHS = [
  "/api/auth/",          // NextAuth OAuth flow (NextAuth's own CSRF token protects its forms)
  "/api/webhooks/slack", // Slack signing secret
  "/api/webhooks/jira",  // Jira webhook signature
  "/api/alerts/generate", // Cron bearer secret
];

/** Reachable without a session. Everything else requires one. */
export function isPublicPath(path: string, method: string): boolean {
  if (path === "/login" || path.startsWith("/login/")) return true;
  if (path.startsWith("/api/auth/")) return true;
  if (path === "/api/health/liveness" || path === "/api/health/readiness") return true;
  if (path === "/api/branding" && method === "GET") return true; // login page branding
  return false;
}

/** Fixed headers on every response (HSTS is added on HTTPS). */
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "X-Permitted-Cross-Domain-Policies": "none",
  "X-DNS-Prefetch-Control": "off",
  "X-XSS-Protection": "0",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/**
 * Content-Security-Policy with a per-request nonce for scripts: no
 * 'unsafe-inline' and no 'unsafe-eval' for scripts ('unsafe-eval' only in
 * development, for React Refresh).
 *
 * Styles: 'unsafe-inline' stays for style-src. The UI libraries (Radix,
 * react-remove-scroll) inject <style> elements without a nonce, and a nonce in
 * style-src would make browsers ignore 'unsafe-inline'. Styles cannot execute
 * script. Recorded as a reviewed exception in docs/phase1/threat-model.md
 * (TODO(CONFIRM-CSP-STYLES) with Platform Security).
 */
export function buildCsp(nonce: string, dev = false): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "frame-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "worker-src 'self'",
    "manifest-src 'self'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
