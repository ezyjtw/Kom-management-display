import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/shared/Sidebar";

export const metadata: Metadata = {
  title: "KOMmand Centre",
  description: "Ops team performance management and communications hub",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 ml-64">
            <div className="p-6">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
