import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { lookupSensitiveAction } from "@/modules/auth/sensitive-actions-registry";
import { SESSION_MAX_AGE_SECONDS, sessionCookieName } from "@/lib/session-config";
import { env } from "@/lib/env";
import { recordPermissionDenied } from "@/modules/security/record";
import { CSRF_HEADER, CSRF_EXEMPT_PATHS, buildCsp, csrfCookieName, SECURITY_HEADERS, isPublicPath } from "@/lib/security-policy";

/**
 * Edge middleware (spec §17.4). Runs on every path except static assets, so a
 * new page or route cannot miss authentication, CSRF protection or the
 * security headers.
 *
 * - Authentication: every path needs a session except the explicit public
 *   paths (sign-in, health probes, signed webhooks).
 * - CSRF: every state-changing request (except signed webhooks and the
 *   NextAuth flow) needs a double-submit token (cookie + header) and, when the
 *   browser sends one, a same-site Origin/Referer.
 * - Sessions: absolute lifetime here (12 h); the 1 h idle timeout is enforced
 *   in requireAuth() where the last-activity time is known.
 * - Headers: a per-request CSP nonce for scripts, plus the fixed headers.
 */

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function allowedOrigins(): string[] {
  const origins: string[] = [];
  if (process.env.NEXTAUTH_URL) {
    try {
      origins.push(new URL(process.env.NEXTAUTH_URL).origin);
    } catch { /* invalid URL */ }
  }
  if (process.env.CSRF_ALLOWED_ORIGINS) origins.push(...process.env.CSRF_ALLOWED_ORIGINS.split(",").map((o) => o.trim()));
  if (process.env.NODE_ENV !== "production") origins.push("http://localhost:3000", "http://127.0.0.1:3000");
  return origins;
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison. */
function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length || !a.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(status: number, error: string, code: string): NextResponse {
  return NextResponse.json({ success: false, error, code }, { status });
}

/** CSRF: double-submit token plus Origin/Referer. Returns an error response or null. */
function isSecure(req: NextRequest): boolean {
  return !!process.env.NEXTAUTH_URL?.startsWith("https://") || req.headers.get("x-forwarded-proto") === "https";
}

export function csrfViolation(req: NextRequest, path: string): NextResponse | null {
  if (!MUTATION_METHODS.has(req.method)) return null;
  if (CSRF_EXEMPT_PATHS.some((p) => path.startsWith(p))) return null;

  const cookie = req.cookies.get(csrfCookieName(isSecure(req)))?.value ?? "";
  const header = req.headers.get(CSRF_HEADER) ?? "";
  if (!sameToken(cookie, header)) return json(403, "Missing or invalid CSRF token", "CSRF_TOKEN_INVALID");

  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const allowed = allowedOrigins();
  let source: string | null = origin;
  if (!source && referer) {
    try {
      source = new URL(referer).origin;
    } catch { source = null; }
  }
  if (process.env.NODE_ENV === "production" && !source) return json(403, "Cross-origin request blocked", "CSRF_REJECTED");
  if (source && allowed.length && !allowed.includes(source)) return json(403, "Cross-origin request blocked", "CSRF_REJECTED");
  return null;
}

function finish(res: NextResponse, req: NextRequest, nonce: string, secure: boolean): NextResponse {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  if (secure) res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.headers.set("Content-Security-Policy", buildCsp(nonce, process.env.NODE_ENV !== "production"));
  const csrfName = csrfCookieName(secure);
  if (!req.cookies.get(csrfName)) {
    // Readable by the page script (double-submit); SameSite=Strict, host-only.
    res.cookies.set(csrfName, randomToken(), { httpOnly: false, sameSite: "strict", secure, path: "/" });
  }
  return res;
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isApi = path.startsWith("/api/");
  const secure = isSecure(req);
  const nonce = btoa(randomToken().slice(0, 32));
  const correlationId = crypto.randomUUID().substring(0, 8);

  const pass = (userId?: string | null) => {
    const headers = new Headers(req.headers);
    // Server-set only: never trust a client-supplied value.
    headers.delete("x-user-id");
    if (userId) headers.set("x-user-id", userId);
    headers.set("x-nonce", nonce);
    headers.set("x-correlation-id", correlationId);
    headers.set("x-http-method", req.method);
    headers.set("x-pathname", path);
    // Next.js reads the nonce from the request CSP header and applies it to its own scripts.
    headers.set("Content-Security-Policy", buildCsp(nonce, process.env.NODE_ENV !== "production"));
    const res = NextResponse.next({ request: { headers } });
    res.headers.set("x-correlation-id", correlationId);
    res.headers.set("x-request-id", correlationId);
    return finish(res, req, nonce, !!secure);
  };
  const deny = (res: NextResponse) => finish(res, req, nonce, !!secure);
  /** Role-gate denial: audited (spec §17.7), counted by ALR-SEC-01. Not awaited: never delays the response. */
  const forbid = (res: NextResponse, userId: string | null, role: string | null, reason: string) => {
    void recordPermissionDenied({ userId, role, method: req.method, path, reason });
    return deny(res);
  };

  // Cron trigger with its own bearer secret.
  if (path === "/api/alerts/generate") {
    const auth = req.headers.get("authorization");
    const cronSecret = env("CRON_SECRET");
    if (auth && cronSecret && sameToken(auth, `Bearer ${cronSecret}`)) return pass();
  }
  // Signed webhooks verify their own signature in the route.
  if ((path.startsWith("/api/webhooks/slack") || path.startsWith("/api/webhooks/jira")) && req.method === "POST") return pass();

  if (isPublicPath(path, req.method)) {
    const csrf = csrfViolation(req, path);
    return csrf ? deny(csrf) : pass();
  }

  const token = await getToken({ req, secret: env("NEXTAUTH_SECRET"), cookieName: sessionCookieName(!!secure) });
  if (!token) {
    if (isApi) return deny(json(401, "Authentication required", "AUTH_REQUIRED"));
    return deny(NextResponse.redirect(new URL("/login", req.url)));
  }
  const role = token.role as string;

  // Absolute session lifetime (12 h) from sign-in.
  const now = Math.floor(Date.now() / 1000);
  const signedInAt = typeof token.authTime === "number" ? token.authTime : typeof token.iat === "number" ? token.iat : now;
  const ageSeconds = now - signedInAt;
  if (ageSeconds > SESSION_MAX_AGE_SECONDS) {
    if (isApi) return deny(json(401, "Session expired (absolute lifetime)", "SESSION_EXPIRED_ABSOLUTE"));
    return deny(NextResponse.redirect(new URL("/login?reason=session_expired", req.url)));
  }

  // Step-up: sensitive actions need a recent sign-in (spec §17.3; registry is the single source).
  if (isApi && MUTATION_METHODS.has(req.method)) {
    const sensitive = lookupSensitiveAction(req.method, path);
    if (sensitive && ageSeconds > sensitive.maxSessionAgeSeconds) {
      return deny(NextResponse.json({
        success: false,
        error: "This action needs a recent sign-in. Sign in again, then retry.",
        code: "REAUTH_REQUIRED",
      }, { status: 401 }));
    }
  }

  // Role gates (the route handlers enforce authorisation again).
  const sub = (token.sub as string | undefined) ?? null;
  if ((path.startsWith("/admin") || path.startsWith("/api/users")) && role !== "admin") {
    if (isApi) return forbid(json(403, "Admin access required", "FORBIDDEN"), sub, role, "admin_only");
    return forbid(NextResponse.redirect(new URL("/work", req.url)), sub, role, "admin_only");
  }
  if ((path.startsWith("/api/scoring-config") || path.startsWith("/api/export")) && !["admin", "lead"].includes(role)) {
    if (isApi) return forbid(json(403, "Insufficient permissions", "FORBIDDEN"), sub, role, "admin_or_lead_only");
    return forbid(NextResponse.redirect(new URL("/work", req.url)), sub, role, "admin_or_lead_only");
  }
  if (role === "auditor" && isApi && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return forbid(json(403, "Auditors have read-only access", "FORBIDDEN"), sub, role, "auditor_read_only");
  }

  const csrf = csrfViolation(req, path);
  if (csrf) return deny(csrf);
  return pass(sub);
}

export const config = {
  // Node.js runtime (stable since Next 15.5) so the middleware reads secrets
  // through the same file loader as the rest of the app (spec §17.3).
  runtime: "nodejs",
  // Everything except Next.js static assets and image files.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?)$).*)"],
};
