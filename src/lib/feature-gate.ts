import { NextResponse } from "next/server";
import { notFound } from "next/navigation";
import { isFeatureEnabled, type SafetyFlagKey } from "@/lib/feature-flags";

/** For API route handlers: a 404 response when the flag is off, otherwise null. */
export async function featureGate(key: SafetyFlagKey): Promise<NextResponse | null> {
  if (await isFeatureEnabled(key)) return null;
  return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
}

/** For server components/layouts: renders the 404 page when the flag is off. */
export async function requireFeature(key: SafetyFlagKey): Promise<void> {
  if (!(await isFeatureEnabled(key))) notFound();
}
