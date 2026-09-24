/**
 * Phase 0 acceptance: custody-client-is-read-only (H2).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  assertPermitted,
  komainuRequest,
  ForbiddenMethodError,
  ForbiddenPathError,
} from "@/lib/integrations/komainu-api/client";
import { isAllowedEndpoint } from "@/lib/integrations/komainu-api/endpoints";

const SRC = path.resolve(__dirname, "..");
const READS_BASE_URL = /(env\(\s*["']KOMAINU_API_BASE_URL["']\s*\)|process\.env\.KOMAINU_API_BASE_URL)/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
}

describe("custody-client-is-read-only", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("static scan: every Komainu HTTP call is GET, except POST /v1/auth/token", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const src = fs.readFileSync(file, "utf8");
      if (!READS_BASE_URL.test(src)) continue;
      let idx = src.indexOf("fetch(");
      while (idx !== -1) {
        const snippet = src.slice(idx, idx + 400);
        const method = (snippet.match(/method:\s*["'`](\w+)["'`]/)?.[1] ?? "GET").toUpperCase();
        const isAuth = method === "POST" && /AUTH_TOKEN_PATH|\/v1\/auth\/token/.test(snippet);
        if (method !== "GET" && !isAuth) offenders.push(`${path.relative(SRC, file)}: ${method}`);
        idx = src.indexOf("fetch(", idx + 1);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("static scan: only the komainu-api client (and the egress allowlist, for the hostname) reads the Komainu base URL", () => {
    const readers = sourceFiles(SRC)
      .filter((f) => READS_BASE_URL.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f))
      .sort();
    expect(readers).toEqual([
      path.join("lib", "http", "allowed-hosts.ts"),
      path.join("lib", "integrations", "komainu-api", "client.ts"),
    ]);
    const allowlist = fs.readFileSync(path.join(SRC, "lib", "http", "allowed-hosts.ts"), "utf8");
    expect(allowlist).not.toMatch(/fetch\(/);
  });

  it("the legacy custody client with approveRequest() is gone", () => {
    expect(fs.existsSync(path.join(SRC, "lib/integrations/custody.ts"))).toBe(false);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("throws ForbiddenMethodError for %s", async (method) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(() => assertPermitted(method, "/v1/requests")).toThrow(ForbiddenMethodError);
    await expect(komainuRequest(method, "/v1/requests/req_1/approve")).rejects.toBeInstanceOf(ForbiddenMethodError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    "/v1/requests/req_1/approve",
    "/v1/requests/req_1/reject",
    "/v1/requests/req_1/challenge",
    "/v1/custody/transactions/estimate-fee/x",
  ])("refuses non-allowlisted GET %s", (p) => {
    expect(() => assertPermitted("GET", p)).toThrow(ForbiddenPathError);
  });

  it("allowlist contains no write endpoints other than the auth token", () => {
    expect(isAllowedEndpoint("POST", "/v1/auth/token")).toBe(true);
    expect(isAllowedEndpoint("POST", "/v1/requests")).toBe(false);
    expect(isAllowedEndpoint("POST", "/v1/custody/transactions/estimate-fee")).toBe(false);
    expect(isAllowedEndpoint("GET", "/v1/requests/req_1")).toBe(true);
  });
});
