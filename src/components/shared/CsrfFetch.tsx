"use client";

/**
 * Adds the double-submit CSRF token (spec §17.4) to every same-origin
 * state-changing fetch, so each call site does not have to. The middleware
 * rejects mutations without it.
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

export function installCsrfFetch(win: Window & typeof globalThis): void {
  const flag = "__komCsrfFetch";
  if ((win as unknown as Record<string, unknown>)[flag]) return;
  (win as unknown as Record<string, unknown>)[flag] = true;
  const original = win.fetch.bind(win);
  win.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = new URL(input instanceof Request ? input.url : String(input), win.location.href);
    if (MUTATIONS.has(method) && url.origin === win.location.origin) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (!headers.has(CSRF_HEADER)) headers.set(CSRF_HEADER, csrfToken());
      return original(input, { ...init, headers });
    }
    return original(input, init);
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
