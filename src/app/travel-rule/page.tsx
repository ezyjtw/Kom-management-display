"use client";

import { useState, useEffect } from "react";
import {
  RefreshCw,
  AlertCircle,
  ShieldAlert,
  Bell,
} from "lucide-react";
import { TravelRuleStats } from "@/components/travel-rule/TravelRuleStats";
import { ReconciliationTable } from "@/components/travel-rule/ReconciliationTable";
import type {
  TravelRuleReconciliationRow,
  TravelRuleMatchStatus,
  TravelRuleOverview,
} from "@/types";

type FilterTab = "all" | "unmatched" | "missing_originator" | "missing_beneficiary" | "matched";

export default function TravelRulePage() {
  const [data, setData] = useState<TravelRuleOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [assetFilter, setAssetFilter] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch("/api/travel-rule");
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      }
    } catch (err) {
      console.error("Failed to fetch travel rule data:", err);
    } finally {
      setLoading(false);
    }
  }

  const summary = data?.summary ?? {
    total: 0,
    matched: 0,
    unmatched: 0,
    missingOriginator: 0,
    missingBeneficiary: 0,
  };

  const configured = data?.configured ?? { komainu: false, notabene: false };

  // Filter rows
  let filteredRows: TravelRuleReconciliationRow[] = data?.rows ?? [];
  if (activeTab !== "all") {
    filteredRows = filteredRows.filter((r) => r.matchStatus === activeTab);
  }
  if (assetFilter) {
    filteredRows = filteredRows.filter((r) => r.asset === assetFilter);
  }

  const assets = [
    ...new Set((data?.rows ?? []).map((r) => r.asset)),
  ].sort();

  const urgentCount = summary.unmatched + summary.missingOriginator + summary.missingBeneficiary;

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    { key: "all", label: "All", count: summary.total },
    { key: "unmatched", label: "No Travel Rule", count: summary.unmatched },
    {
      key: "missing_originator",
      label: "Missing Originator",
      count: summary.missingOriginator,
    },
    {
      key: "missing_beneficiary",
      label: "Missing Beneficiary",
      count: summary.missingBeneficiary,
    },
    { key: "matched", label: "Matched", count: summary.matched },
  ];

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <ShieldAlert size={24} className="text-primary" />
            Travel Rule Reconciliation
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Real-time matching of Komainu transactions against Notabene travel
            rule transfers
          </p>
        </div>
        <div className="flex items-center gap-2">
          {urgentCount > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-2 text-sm bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 font-semibold animate-pulse">
              <Bell size={16} />
              {urgentCount} urgent
            </div>
          )}
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground bg-card border border-border rounded-lg hover:bg-accent/50"
          >
            <RefreshCw
              size={16}
              className={loading ? "animate-spin" : ""}
            />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Config warnings */}
      {!configured.komainu && !loading && (
        <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
          <AlertCircle size={20} className="text-amber-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-400">
              Komainu API not configured
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Set KOMAINU_API_BASE_URL, KOMAINU_API_USER, and
              KOMAINU_API_SECRET to fetch transactions.
            </p>
          </div>
        </div>
      )}
      {!configured.notabene && !loading && (
        <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
          <AlertCircle size={20} className="text-amber-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-400">
              Notabene API not configured
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Set NOTABENE_API_BASE_URL, NOTABENE_API_TOKEN, and
              NOTABENE_VASP_DID to fetch travel rule transfers.
            </p>
          </div>
        </div>
      )}

      {/* Stats */}
      <TravelRuleStats summary={summary} />

      {/* Tabs + Asset filter */}
      <div className="flex flex-wrap items-center gap-3 md:gap-4 bg-card rounded-xl border border-border p-3 md:p-4">
        <div className="flex flex-wrap gap-1 bg-muted/50 rounded-lg p-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span
                  className={`ml-1.5 text-xs ${
                    activeTab === tab.key
                      ? "text-primary-foreground/80"
                      : tab.key !== "all" && tab.key !== "matched" && tab.count > 0
                        ? "text-red-400"
                        : "text-muted-foreground"
                  }`}
                >
                  ({tab.count})
                </span>
              )}
            </button>
          ))}
        </div>
        {assets.length > 0 && (
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Asset
            </label>
            <select
              value={assetFilter}
              onChange={(e) => setAssetFilter(e.target.value)}
              className="text-sm border border-border rounded-lg px-3 py-1.5"
            >
              <option value="">All Assets</option>
              {assets.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center text-muted-foreground">
          <RefreshCw size={24} className="mx-auto mb-3 animate-spin" />
          Reconciling travel rule data...
        </div>
      ) : (
        <ReconciliationTable rows={filteredRows} />
      )}
    </div>
  );
}
