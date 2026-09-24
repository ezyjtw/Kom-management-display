"use client";

/**
 * Wraps window.fetch for same-origin API calls (spec §17.3, §17.4):
 * - adds the double-submit CSRF token to every state-changing request, so each
 *   call site does not have to (the middleware rejects mutations without it);
 * - on 401 REAUTH_REQUIRED (a sensitive action with a stale sign-in), offers a
 *   fresh Entra sign-in (prompt=login) and returns to the page;
 * - on an expired session, goes to the sign-in page.
 * The caller still receives the original response and shows its error.
 */
import { useEffect } from "react";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/security-policy";

const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function csrfToken(): string {
  for (const name of [`__Host-${CSRF_COOKIE}`, CSRF_COOKIE]) {
    const m = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
    if (m) return decodeURIComponent(m.slice(name.length + 1));
  }
  return "";
}

const EXPIRED = new Set(["SESSION_EXPIRED_IDLE", "SESSION_EXPIRED_ABSOLUTE", "SESSION_REVOKED", "AUTH_REQUIRED"]);

/** Where to send the browser for an auth error code, or null to stay. */
export function authRedirectFor(code: string | undefined, href: string): { url: string; confirm: boolean } | null {
  const here = new URL(href);
  const callbackUrl = encodeURIComponent(here.pathname + here.search);
  if (code === "REAUTH_REQUIRED") return { url: `/login?reauth=1&callbackUrl=${callbackUrl}`, confirm: true };
  if (code && EXPIRED.has(code)) return { url: `/login?reason=session_expired&callbackUrl=${callbackUrl}`, confirm: false };
  return null;
}

async function handleAuthError(win: Window & typeof globalThis, res: Response): Promise<void> {
  if (res.status !== 401 || win.location.pathname.startsWith("/login")) return;
  const code = await res.clone().json().then((b: { code?: string }) => b?.code).catch(() => undefined);
  const target = authRedirectFor(code, win.location.href);
  if (!target) return;
  if (target.confirm && !win.confirm("This action needs a recent sign-in. Sign in again now? You will come back to this page and can retry.")) return;
  win.location.assign(target.url);
}

export function installCsrfFetch(win: Window & typeof globalThis): void {
  const flag = "__komCsrfFetch";
  if ((win as unknown as Record<string, unknown>)[flag]) return;
  (win as unknown as Record<string, unknown>)[flag] = true;
  const original = win.fetch.bind(win);
  win.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = new URL(input instanceof Request ? input.url : String(input), win.location.href);
    const sameOrigin = url.origin === win.location.origin;
    let res: Response;
    if (MUTATIONS.has(method) && sameOrigin) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (!headers.has(CSRF_HEADER)) headers.set(CSRF_HEADER, csrfToken());
      res = await original(input, { ...init, headers });
    } else {
      res = await original(input, init);
    }
    if (sameOrigin && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/")) void handleAuthError(win, res);
    return res;
  };
}

// Install as soon as the module loads in the browser (before any effect fires).
if (typeof window !== "undefined") installCsrfFetch(window);

export function CsrfFetch() {
  useEffect(() => {
    installCsrfFetch(window);
  }, []);
  return null;
}
