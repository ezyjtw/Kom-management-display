/**
 * Spec §17.3: a sensitive action with a stale sign-in answers 401
 * REAUTH_REQUIRED (middleware); the browser offers a fresh Entra sign-in with
 * prompt=login and returns to the page. Session expiry goes to /login.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));
import { authRedirectFor, installCsrfFetch } from "@/components/shared/CsrfFetch";
import { safeCallback } from "@/lib/safe-callback";

describe("step-up re-authentication (client)", () => {
  it("maps auth error codes to the sign-in page, keeping the current page as callback", () => {
    expect(authRedirectFor("REAUTH_REQUIRED", "https://kom.example/work/w1?tab=2")).toEqual({ url: "/login?reauth=1&callbackUrl=%2Fwork%2Fw1%3Ftab%3D2", confirm: true });
    expect(authRedirectFor("SESSION_EXPIRED_IDLE", "https://kom.example/morning")?.url).toBe("/login?reason=session_expired&callbackUrl=%2Fmorning");
    expect(authRedirectFor("SESSION_EXPIRED_IDLE", "https://kom.example/morning")?.confirm).toBe(false);
    expect(authRedirectFor("FORBIDDEN", "https://kom.example/x")).toBeNull();
    expect(authRedirectFor(undefined, "https://kom.example/x")).toBeNull();
  });

  it("the fetch shim sends the user to re-authenticate after they confirm, and still returns the response", async () => {
    const assign = vi.fn();
    const confirm = vi.fn(() => true);
    const original = vi.fn(async () => new Response(JSON.stringify({ success: false, code: "REAUTH_REQUIRED" }), { status: 401 }));
    const win = { fetch: original, location: { href: "https://kom.example/admin/users", origin: "https://kom.example", pathname: "/admin/users", assign }, confirm } as unknown as Window & typeof globalThis;
    Object.defineProperty(globalThis, "document", { value: { cookie: "kom.csrf=abc" }, configurable: true });
    installCsrfFetch(win);
    const res = await win.fetch("/api/users", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    await new Promise((r) => setTimeout(r, 0));
    expect(confirm).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith("/login?reauth=1&callbackUrl=%2Fadmin%2Fusers");
    const sent = (original.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(sent.headers).get("x-csrf-token")).toBe("abc");
  });

  it("only returns to same-site paths after sign-in", () => {
    expect(safeCallback("/work/w1?x=1")).toBe("/work/w1?x=1");
    expect(safeCallback("//evil.example/x")).toBe("/dashboard");
    expect(safeCallback("/\\evil.example")).toBe("/dashboard");
    expect(safeCallback("https://evil.example")).toBe("/dashboard");
    expect(safeCallback(null)).toBe("/dashboard");
  });

  it("the middleware answers REAUTH_REQUIRED for a sensitive action with a stale sign-in", async () => {
    const { getToken } = await import("next-auth/jwt");
    const { middleware } = await import("@/middleware");
    const { NextRequest } = await import("next/server");
    const now = Math.floor(Date.now() / 1000);
    const call = async (authTime: number) => {
      vi.mocked(getToken).mockResolvedValue({ role: "admin", sub: "u1", authTime } as never);
      const req = new NextRequest("http://localhost:3000/api/feature-flags", {
        method: "PUT",
        headers: { origin: "http://localhost:3000", cookie: "kom.csrf=t", "x-csrf-token": "t" },
      });
      return middleware(req);
    };
    const stale = await call(now - 3 * 3600); // registry: 2 h for feature flag changes
    expect(stale.status).toBe(401);
    expect((await stale.json()).code).toBe("REAUTH_REQUIRED");
    expect((await call(now - 60)).status).toBe(200);
  });
});
