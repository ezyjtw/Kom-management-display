/**
 * Spec §16: no live network in CI. Any test that calls fetch without stubbing
 * it (vi.stubGlobal("fetch", ...)) fails with the host it tried to reach.
 */
import { beforeEach } from "vitest";

export class UnmockedNetworkError extends Error {
  constructor(target: string) {
    super(`Unmocked network call in a test: ${target}. Stub fetch for this test.`);
    this.name = "UnmockedNetworkError";
  }
}

const blockedFetch: typeof fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let host = url;
  try { host = new URL(url).host; } catch { /* relative or invalid */ }
  throw new UnmockedNetworkError(host);
};

globalThis.fetch = blockedFetch;
beforeEach(() => {
  globalThis.fetch = blockedFetch;
});
