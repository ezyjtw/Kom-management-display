"use client";

import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Sidebar } from "@/components/shared/Sidebar";
import GlobalSearch from "@/components/GlobalSearch";
import { NotificationToast } from "@/components/NotificationToast";

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
        <div className="hidden md:flex sticky top-0 z-30 bg-background/80 backdrop-blur border-b border-border px-6 py-2 items-center justify-center">
          <GlobalSearch />
        </div>
        <div className="p-4 pt-16 md:pt-4 md:p-6">{children}</div>
      </main>
      <NotificationToast />
    </div>
  );
}
