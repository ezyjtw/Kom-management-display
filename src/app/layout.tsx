import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SessionProvider } from "@/components/shared/SessionProvider";
import { AppShell } from "@/components/shared/AppShell";
import { CsrfFetch } from "@/components/shared/CsrfFetch";
import { headers } from "next/headers";

// Validate environment variables at startup — fails fast on misconfiguration in production
import "@/lib/env";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_APP_NAME || "KOMmand Centre",
  description: "Ops team performance management and communications hub",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Reading the request headers renders every page per request, so Next.js can
  // apply the middleware's CSP nonce to its scripts (spec §17.4).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased" data-nonce-present={nonce ? "true" : undefined}>
        <CsrfFetch />
        <SessionProvider>
          <AppShell>{children}</AppShell>
        </SessionProvider>
      </body>
    </html>
  );
}
