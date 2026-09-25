"use client";

import { BACKGROUND_REQUEST_HEADER } from "@/lib/background-request";

/** Same-origin fetch for automatic refreshes: marked so it is not user activity. */
export function backgroundFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if (!input.startsWith("/")) throw new Error("backgroundFetch is for same-origin API paths only");
  const headers = new Headers(init.headers);
  headers.set(BACKGROUND_REQUEST_HEADER, "1");
  return fetch(input, { cache: "no-store", ...init, headers });
}
