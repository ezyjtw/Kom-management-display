/**
 * Outbound retry with backoff on 429 / transient 5xx (spec §8.1).
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/http/allowed-hosts", () => ({ getAllowedHosts: () => new Set(["custody-demo.example.com"]) }));

import { httpFetchWithRetry, rateLimitRemaining } from "@/lib/http/client";

afterEach(() => vi.unstubAllGlobals());

const res = (status: number, headers: Record<string, string> = {}) => new Response("{}", { status, headers });

describe("httpFetchWithRetry", () => {
  it("retries 429 honouring Retry-After, then returns the success", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res(429, { "retry-after": "2" }))
      .mockResolvedValueOnce(res(200, { "x-ratelimit-remaining": "41" }));
    vi.stubGlobal("fetch", fetchMock);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onRateLimit = vi.fn();

    const r = await httpFetchWithRetry("https://custody-demo.example.com/v1/requests", undefined, { sleep, onRateLimit });
    expect(r.status).toBe(200);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(onRateLimit).toHaveBeenCalledWith(41);
  });

  it("backs off exponentially and gives up after maxAttempts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => res(503)));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const r = await httpFetchWithRetry("https://custody-demo.example.com/x", undefined, { sleep, maxAttempts: 3, baseDelayMs: 100 });
    expect(r.status).toBe(503);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 200]);
  });

  it("does not retry client errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(404));
    vi.stubGlobal("fetch", fetchMock);
    await httpFetchWithRetry("https://custody-demo.example.com/x", undefined, { sleep: vi.fn() });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads rate-limit headers", () => {
    expect(rateLimitRemaining(res(200, { "x-rate-limit-remaining": "7" }))).toBe(7);
    expect(rateLimitRemaining(res(200))).toBeUndefined();
  });
});
