"use client";

import { useState, useEffect } from "react";
import { RefreshCw, AlertTriangle, Plus, Layers, X } from "lucide-react";
import { RewardHealthBadge } from "@/components/shared/StatusBadge";
import type { StakingWalletEntry } from "@/types";

interface StakingData {
  wallets: StakingWalletEntry[];
  summary: {
    total: number;
    active: number;
    overdue: number;
    approaching: number;
    coldStaking: number;
    reconciliationFlags: number;
  };
}

type Tab = "all" | "heartbeat" | "cold" | "reconciliation";

export default function StakingPage() {
  const [data, setData] = useState<StakingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("all");
  const [showForm, setShowForm] = useState(false);
  const [filterAsset, setFilterAsset] = useState("");

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch("/api/staking");
      const json = await res.json();
      if (json.success) setData(json.data);
    } catch { /* */ } finally { setLoading(false); }
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = {
      walletAddress: form.get("walletAddress"),
      asset: form.get("asset"),
      rewardModel: form.get("rewardModel"),
      clientName: form.get("clientName"),
      stakedAmount: parseFloat(form.get("stakedAmount") as string) || 0,
      validator: form.get("validator"),
      isColdStaking: form.get("isColdStaking") === "on",
    };
    await fetch("/api/staking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setShowForm(false);
    fetchData();
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground"><RefreshCw size={24} className="animate-spin mr-3" />Loading staking data...</div>;
  }

  if (!data) {
    return <div className="text-center py-12"><AlertTriangle size={24} className="mx-auto mb-3 text-red-400" /><p className="text-muted-foreground">Failed to load staking data.</p></div>;
  }

  const filtered = data.wallets.filter((w) => {
    if (filterAsset && w.asset !== filterAsset) return false;
    if (tab === "heartbeat") return w.status === "active" && (w.rewardHealth === "overdue" || w.rewardHealth === "approaching");
    if (tab === "cold") return w.isColdStaking;
    if (tab === "reconciliation") return w.varianceFlag;
    return true;
  });

  const assets = [...new Set(data.wallets.map((w) => w.asset))].sort();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <Layers size={24} className="text-primary" /> Staking Operations
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">Monitor staking wallets, reward heartbeats, and reconciliation</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"><Plus size={16} /> Add Wallet</button>
          <button onClick={fetchData} className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground bg-card border border-border rounded-lg hover:bg-accent/50"><RefreshCw size={16} /></button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: "Total Wallets", value: data.summary.total },
          { label: "Active", value: data.summary.active },
          { label: "Overdue Rewards", value: data.summary.overdue, color: data.summary.overdue > 0 ? "text-red-400" : "" },
          { label: "Cold Staking", value: data.summary.coldStaking },
          { label: "Recon Flags", value: data.summary.reconciliationFlags, color: data.summary.reconciliationFlags > 0 ? "text-amber-400" : "" },
        ].map((c) => (
          <div key={c.label} className="bg-card rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className={`text-xl font-bold ${c.color || "text-foreground"}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs + filters */}
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "heartbeat", "cold", "reconciliation"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 text-xs rounded-lg border ${tab === t ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:bg-accent/50"}`}>
            {t === "all" ? "All Wallets" : t === "heartbeat" ? "Reward Alerts" : t === "cold" ? "Cold Staking" : "Reconciliation"}
          </button>
        ))}
        <select value={filterAsset} onChange={(e) => setFilterAsset(e.target.value)} className="ml-auto px-3 py-1.5 text-xs rounded-lg bg-card border border-border text-foreground">
          <option value="">All Assets</option>
          {assets.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-3">Asset</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Wallet</th>
              <th className="px-4 py-3">Staked</th>
              <th className="px-4 py-3">Model</th>
              <th className="px-4 py-3">Reward Health</th>
              <th className="px-4 py-3">Status</th>
              {tab === "reconciliation" && <th className="px-4 py-3">Variance</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No wallets match filters</td></tr>
            ) : filtered.map((w) => (
              <tr key={w.id} className="border-b border-border/50 hover:bg-accent/20">
                <td className="px-4 py-3 font-medium">{w.asset}</td>
                <td className="px-4 py-3 text-muted-foreground">{w.clientName || "—"}</td>
                <td className="px-4 py-3 font-mono text-xs truncate max-w-[160px]">{w.walletAddress}</td>
                <td className="px-4 py-3">{w.stakedAmount.toLocaleString()}</td>
                <td className="px-4 py-3 text-muted-foreground">{w.rewardModel}</td>
                <td className="px-4 py-3"><RewardHealthBadge status={w.rewardHealth} /></td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${w.status === "active" ? "bg-emerald-500/10 text-emerald-400" : w.status === "unstaking" ? "bg-amber-500/10 text-amber-400" : "bg-muted text-muted-foreground"}`}>
                    {w.status}
                  </span>
                </td>
                {tab === "reconciliation" && (
                  <td className="px-4 py-3">
                    {w.onChainBalance != null && w.platformBalance != null ? (
                      <span className={w.varianceFlag ? "text-red-400 font-medium" : "text-muted-foreground"}>
                        {(w.onChainBalance - w.platformBalance).toFixed(4)}
                      </span>
                    ) : "—"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Add Staking Wallet</h3>
              <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <input name="walletAddress" placeholder="Wallet Address" required className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg" />
              <div className="grid grid-cols-2 gap-3">
                <input name="asset" placeholder="Asset (e.g. ETH)" required className="px-3 py-2 text-sm bg-background border border-border rounded-lg" />
                <select name="rewardModel" required className="px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground">
                  <option value="">Reward Model</option>
                  {["auto", "daily", "weekly", "monthly", "manual_claim", "rebate"].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <input name="clientName" placeholder="Client Name" className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg" />
              <div className="grid grid-cols-2 gap-3">
                <input name="stakedAmount" type="number" step="any" placeholder="Staked Amount" className="px-3 py-2 text-sm bg-background border border-border rounded-lg" />
                <input name="validator" placeholder="Validator" className="px-3 py-2 text-sm bg-background border border-border rounded-lg" />
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" name="isColdStaking" className="rounded" /> Cold Staking
              </label>
              <button type="submit" className="w-full px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">Create Wallet</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
