"use client";

import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Sidebar } from "@/components/shared/Sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();

  // Don't show sidebar on login page
  const isLoginPage = pathname === "/login";

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar user={session?.user as any} />
      <main className="flex-1 ml-0 md:ml-64">
        <div className="p-4 pt-16 md:pt-6 md:p-6">{children}</div>
      </main>
    </div>
  );
}
