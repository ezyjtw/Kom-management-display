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
  AlertTriangle,
  ArrowDownUp,
  Layers,
  ClipboardCheck, ClipboardList,
  ScanSearch,
  FileSearch,
  Coins,
  BookUser,
  Scale,
  ShieldCheck,
  Cog,
  Flag,
  Monitor,
  Send,
  Upload,
  Inbox,
  Sunrise,
  Building2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBranding } from "@/lib/use-branding";
import { useState, useEffect } from "react";
import type { SafetyFlagKey } from "@/lib/feature-flags";
import { DesktopAlertsToggle } from "@/components/shared/DesktopAlerts";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Zap;
  flag?: SafetyFlagKey;
  /** Only role admin: matches the middleware rule that /admin is admin-only. */
  adminOnly?: true;
  /** Shown only when /api/me/capabilities grants it (e.g. kps:view). */
  capability?: "kps";
}

/**
 * Spec §14.1 navigation. Removed: approvals (deleted); USDC ramp, AI briefing
 * and compliance bot (flags off); scoring and activity (flags off). GX sprints
 * arrive with Phase 11. Pages the spec does not list stay reachable under
 * "Other tools".
 */
const navSections: Array<{ label: string; items: NavItem[]; collapsible?: true }> = [
  {
    label: "Work",
    items: [
      { href: "/work", label: "Work", icon: Inbox },
      { href: "/boards", label: "Team Boards", icon: ClipboardList },
      { href: "/daily-checks", label: "Daily Checks", icon: ClipboardCheck },
      { href: "/alerts", label: "Alerts", icon: Bell },
      { href: "/clients/overview", label: "Clients", icon: Users },
      { href: "/morning", label: "Morning Board", icon: Sunrise },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/settlements", label: "Settlements (OES)", icon: ArrowDownUp },
      { href: "/travel-rule", label: "Travel Rule", icon: ShieldAlert },
      { href: "/staking", label: "Staking", icon: Layers },
      { href: "/kps", label: "KPS", icon: Scale, capability: "kps" },
      { href: "/fab", label: "FAB", icon: Building2, flag: "module.fab" as SafetyFlagKey },
      { href: "/tokens", label: "Coin Reviews", icon: Coins },
      { href: "/incidents", label: "Incidents", icon: AlertTriangle },
      { href: "/rca", label: "RCA", icon: FileSearch },
    ],
  },
  {
    label: "Insight",
    items: [
      { href: "/metrics", label: "Metrics", icon: BarChart3 },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/admin", label: "Admin Panel", icon: Settings, adminOnly: true },
      { href: "/admin/imports", label: "Imports", icon: Upload, adminOnly: true },
      { href: "/admin/feature-flags", label: "Feature Flags", icon: Flag, adminOnly: true },
      { href: "/admin/audit", label: "Audit Log", icon: Shield, adminOnly: true },
      { href: "/admin/jobs", label: "Jobs & Health", icon: Cog, adminOnly: true },
    ],
  },
  {
    label: "Other tools",
    collapsible: true,
    items: [
      { href: "/", label: "Command Centre", icon: Zap },
      { href: "/comms", label: "Communications", icon: MessageSquare },
      { href: "/transactions", label: "Transactions", icon: ArrowUpDown },
      { href: "/transaction-confirmations", label: "TX Confirmations", icon: ShieldCheck },
      { href: "/screening", label: "Screening", icon: ScanSearch },
      { href: "/schedule", label: "Schedule & Tasks", icon: CalendarClock },
      { href: "/client-comms", label: "Client Comms", icon: Send },
      { href: "/client-preferences", label: "Client Comms Prefs", icon: BookUser },
      { href: "/projects", label: "Projects", icon: FolderKanban },
      { href: "/dashboard", label: "Team Overview", icon: LayoutDashboard, flag: "people.scoring" as SafetyFlagKey },
      { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/admin/sessions", label: "Sessions", icon: Monitor, adminOnly: true },
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
  // Same rule as src/middleware.ts: /admin and /api/users are admin-only (leads included in neither).
  const isAdmin = user?.role === "admin";
  const [mobileOpen, setMobileOpen] = useState(false);
  const { branding } = useBranding();
  const [clientCommsDraftCount, setClientCommsDraftCount] = useState(0);
  // Flag-gated items stay hidden until the server says the flag is on.
  const [enabledFlags, setEnabledFlags] = useState<Record<string, boolean>>({});
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});
  const [openOther, setOpenOther] = useState(false);
  const inSection = (items: NavItem[]) => items.some((i) => (i.href === "/" ? pathname === "/" : pathname === i.href || pathname?.startsWith(`${i.href}/`)));

  // Expand "Other tools" when the current page lives there; otherwise keep the user's choice for this session.
  useEffect(() => {
    const other = navSections.find((sec) => sec.collapsible);
    if (other && inSection(other.items)) {
      setOpenOther(true);
      return;
    }
    try {
      setOpenOther(window.sessionStorage.getItem("kom.nav.other") === "open");
    } catch {
      // storage unavailable
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute on navigation only
  }, [pathname]);
  const toggleOther = () => setOpenOther((o) => {
    try {
      window.sessionStorage.setItem("kom.nav.other", o ? "closed" : "open");
    } catch {
      // storage unavailable
    }
    return !o;
  });

  useEffect(() => {
    fetch("/api/me/capabilities")
      .then((r) => r.json())
      .then((json) => { if (json.success) setCapabilities(json.data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const keys = navSections.flatMap((s) => s.items).flatMap((i) => (i.flag ? [i.flag] : []));
    fetch(`/api/feature-flags?keys=${encodeURIComponent(keys.join(","))}`)
      .then((r) => r.json())
      .then((json) => { if (json.success) setEnabledFlags(json.data.flags); })
      .catch(() => {});
  }, []);

  // Fetch client comms draft count
  useEffect(() => {
    async function fetchDraftCount() {
      try {
        const res = await fetch("/api/client-comms?status=draft");
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          const total = json.data.reduce(
            (acc: number, g: { drafts: unknown[] }) => acc + (g.drafts?.length || 0),
            0,
          );
          setClientCommsDraftCount(total);
        }
      } catch { /* silent */ }
    }
    fetchDraftCount();
    const interval = setInterval(fetchDraftCount, 60_000);
    return () => clearInterval(interval);
  }, []);

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
                // eslint-disable-next-line @next/next/no-img-element
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
              {section.collapsible ? (
                <button onClick={toggleOther} aria-expanded={openOther} className="w-full flex items-center gap-1 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {openOther ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {section.label}
                </button>
              ) : (
                <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {section.label}
                </p>
              )}
              {(!section.collapsible || openOther) && section.items
                .filter((item) => !item.adminOnly || isAdmin)
                .filter((item) => !item.flag || enabledFlags[item.flag] === true)
                .filter((item) => !item.capability || capabilities[item.capability] === true)
                .map((item) => {
                  const Icon = item.icon;
                  const isActive = item.href === "/"
                    ? pathname === "/"
                    : item.href === "/admin" || item.href === "/clients"
                      ? pathname === item.href
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
                      {item.href === "/client-comms" && clientCommsDraftCount > 0 && (
                        <span className="ml-auto bg-amber-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                          {clientCommsDraftCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
            </div>
          ))}
        </nav>

        {/* User / Footer */}
        <div className="p-4 border-t border-border space-y-3">
          <DesktopAlertsToggle />
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
