import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SessionProvider } from "@/components/shared/SessionProvider";
import { AppShell } from "@/components/shared/AppShell";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_APP_NAME || "KOMmand Centre",
  description: "Ops team performance management and communications hub",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <SessionProvider>
          <AppShell>{children}</AppShell>
        </SessionProvider>
      </body>
    </html>
  );
}
