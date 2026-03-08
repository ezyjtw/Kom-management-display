"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  MessageSquare,
  Settings,
  Users,
  Bell,
  BarChart3,
  Shield,
  ShieldAlert,
  Zap,
  LogOut,
  Menu,
  X,
  ArrowUpDown,
  CalendarClock,
  FolderKanban,
  Activity,
  AlertTriangle,
  Sparkles,
  ArrowDownUp,
  DollarSign,
  Layers,
  ClipboardCheck,
  UserCheck,
  ScanSearch,
  FileSearch,
  Coins,
  BookUser,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBranding } from "@/lib/use-branding";
import { useState, useEffect } from "react";

const navSections = [
  {
    label: "Core",
    items: [
      { href: "/", label: "Command Centre", icon: Zap },
      { href: "/dashboard", label: "Team Overview", icon: LayoutDashboard },
      { href: "/comms", label: "Communications", icon: MessageSquare },
      { href: "/transactions", label: "Transactions", icon: ArrowUpDown },
      { href: "/schedule", label: "Schedule & Tasks", icon: CalendarClock },
      { href: "/activity", label: "Activity Tracker", icon: Activity },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/staking", label: "Staking Ops", icon: Layers },
      { href: "/daily-checks", label: "Daily Checks", icon: ClipboardCheck },
      { href: "/approvals", label: "Approvals Queue", icon: UserCheck },
      { href: "/screening", label: "Screening", icon: ScanSearch },
      { href: "/tokens", label: "Token Review", icon: Coins },
      { href: "/travel-rule", label: "Travel Rule", icon: ShieldAlert },
      { href: "/settlements", label: "OES Settlements", icon: ArrowDownUp },
      { href: "/usdc-ramp", label: "USDC Ramp", icon: DollarSign },
    ],
  },
  {
    label: "Tracking",
    items: [
      { href: "/incidents", label: "Incidents", icon: AlertTriangle },
      { href: "/rca", label: "RCA Tracker", icon: FileSearch },
      { href: "/clients", label: "Client Issues", icon: Users },
      { href: "/client-preferences", label: "Client Comms Prefs", icon: BookUser },
      { href: "/projects", label: "Projects", icon: FolderKanban },
      { href: "/briefing", label: "AI Briefing", icon: Sparkles },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/admin", label: "Admin Panel", icon: Settings, adminOnly: true },
      { href: "/admin/alerts", label: "Alerts", icon: Bell },
      { href: "/admin/audit", label: "Audit Log", icon: Shield, adminOnly: true },
      { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
];

interface SidebarProps {
  user?: {
    name?: string | null;
    email?: string | null;
    role?: string;
  };
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const isAdmin = user?.role === "admin" || user?.role === "lead";
  const [mobileOpen, setMobileOpen] = useState(false);
  const { branding } = useBranding();

  // Close sidebar on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-50 p-2 bg-card border border-border rounded-lg md:hidden"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      {/* Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 h-full w-64 bg-card border-r border-border flex flex-col z-50 transition-transform duration-200",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {branding.logoData ? (
                <img src={branding.logoData} alt={branding.appName} className="h-8 w-8 rounded-lg object-contain" />
              ) : (
                <div className="p-1.5 bg-primary/10 rounded-lg">
                  <Zap size={20} className="text-primary" />
                </div>
              )}
              <div>
                <h1 className="text-lg font-bold tracking-tight text-foreground">{branding.appName}</h1>
                <p className="text-xs text-muted-foreground">{branding.subtitle}</p>
              </div>
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              className="md:hidden text-muted-foreground hover:text-foreground"
              aria-label="Close menu"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Nav Sections */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navSections.map((section, sIdx) => (
            <div key={section.label} className={sIdx > 0 ? "pt-4" : ""}>
              <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {section.label}
              </p>
              {section.items
                .filter((item) => !("adminOnly" in item && item.adminOnly) || isAdmin)
                .map((item) => {
                  const Icon = item.icon;
                  const isActive = item.href === "/"
                    ? pathname === "/"
                    : pathname?.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      )}
                    >
                      <Icon size={18} />
                      {item.label}
                    </Link>
                  );
                })}
            </div>
          ))}
        </nav>

        {/* User / Footer */}
        <div className="p-4 border-t border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Users size={16} className="text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{user?.name || "Not signed in"}</p>
                <p className="text-xs text-muted-foreground capitalize">{user?.role || ""}</p>
              </div>
            </div>
            {user && (
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Sign out"
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
