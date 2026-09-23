/**
 * allowed-hosts-enforced (spec §6.4, §16).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { buildAllowedHosts } from "@/lib/http/allowed-hosts";
import { assertEgressAllowed, httpFetch, EgressDeniedError } from "@/lib/http/client";

const SRC = path.resolve(__dirname, "..");
const SERVER_DIRS = ["lib", "modules", "worker", path.join("app", "api")];
const CLIENT_FILE = path.join("lib", "http", "client.ts");

function files(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : files(full);
    return /\.ts$/.test(e.name) ? [full] : [];
  });
}

describe("allowed hosts", () => {
  const hosts = buildAllowedHosts({
    KOMAINU_API_BASE_URL: "https://api-demo.komainu.io/",
    EGRESS_EXTRA_HOSTS: " api.coingecko.com , ",
  });

  it("contains exactly the spec hosts plus configured extras", () => {
    expect([...hosts].sort()).toEqual([
      "api-demo.komainu.io",
      "api.atlassian.com",
      "api.coingecko.com",
      "graph.microsoft.com",
      "komainu.atlassian.net",
      "login.microsoftonline.com",
      "slack.com",
    ]);
  });

  it("uses ATLASSIAN_BASE_URL when set", () => {
    expect(buildAllowedHosts({ ATLASSIAN_BASE_URL: "https://other.atlassian.net" }).has("other.atlassian.net")).toBe(true);
  });
});

describe("httpFetch", () => {
  afterEach(() => vi.unstubAllGlobals());
  const hosts = buildAllowedHosts({});

  it("allows listed hosts and blocks everything else", () => {
    expect(() => assertEgressAllowed("https://slack.com/api/chat.postMessage", hosts)).not.toThrow();
    for (const url of ["https://api.groq.com/x", "https://slack.com.evil.io/", "ftp://slack.com/", "https://evil.io/?h=slack.com"]) {
      expect(() => assertEgressAllowed(url, hosts), url).toThrow(EgressDeniedError);
    }
  });

  it("never calls the network for a blocked host", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(Promise.resolve().then(() => httpFetch("https://example.com/"))).rejects.toBeInstanceOf(EgressDeniedError);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("static scan", () => {
  it("server code makes no outbound fetch() except through src/lib/http/client.ts", () => {
    const offenders: string[] = [];
    for (const dir of SERVER_DIRS) {
      for (const file of files(path.join(SRC, dir))) {
        const rel = path.relative(SRC, file);
        if (rel === CLIENT_FILE) continue;
        const src = fs.readFileSync(file, "utf8");
        if (src.startsWith('"use client"')) continue;
        // global fetch( to anything but a same-origin relative path
        const re = /(?<![\w.])fetch\(\s*(?!["'`]\/)/g;
        if (re.test(src)) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
