"use client";

import { useState, useEffect } from "react";
import { RefreshCw, AlertTriangle, Shield, ShieldCheck, ShieldAlert, Clock, CheckCircle2, XCircle, ArrowUpRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Confirmation {
  id: string;
  transactionId: string;
  requestId: string | null;
  riskLevel: string;
  asset: string;
  amount: number;
  direction: string;
  account: string;
  workspace: string;
  status: string;
  acknowledgedAt: string | null;
  signedOffAt: string | null;
  escalatedAt: string | null;
  escalationReason: string;
  slackNotifiedAt: string | null;
  emailNotifiedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface Summary {
  pending: number;
  acknowledged: number;
  signedOff: number;
  escalated: number;
  expired: number;
}

const RISK_COLORS: Record<string, string> = {
  low: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  medium: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  high: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  critical: "bg-red-500/10 text-red-400 border-red-500/30",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-400",
  acknowledged: "bg-blue-500/10 text-blue-400",
  signed_off: "bg-emerald-500/10 text-emerald-400",
  escalated: "bg-red-500/10 text-red-400",
  expired: "bg-slate-500/10 text-slate-400",
};

export default function TransactionConfirmationsPage() {
  const [confirmations, setConfirmations] = useState<Confirmation[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch("/api/transaction-confirmations");
      const json = await res.json();
      if (json.success) {
        setConfirmations(json.data.confirmations);
        setSummary(json.data.summary);
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }

  async function handleAction(confirmationId: string, action: string) {
    const body: Record<string, string> = { action, confirmationId };
    if (action === "escalate") {
      const reason = prompt("Escalation reason:");
      if (!reason) return;
      body.reason = reason;
    }
    await fetch("/api/transaction-confirmations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    fetchData();
  }

  const filtered = filter === "all"
    ? confirmations
    : confirmations.filter((c) => c.status === filter);

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground"><RefreshCw size={24} className="animate-spin mr-3" />Loading confirmations...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
          <Shield size={24} /> Transaction Confirmations
        </h1>
        <button onClick={fetchData} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "Pending", value: summary.pending, icon: Clock, color: "text-yellow-400" },
            { label: "Acknowledged", value: summary.acknowledged, icon: CheckCircle2, color: "text-blue-400" },
            { label: "Signed Off", value: summary.signedOff, icon: ShieldCheck, color: "text-emerald-400" },
            { label: "Escalated", value: summary.escalated, icon: ShieldAlert, color: "text-red-400" },
            { label: "Expired", value: summary.expired, icon: XCircle, color: "text-slate-400" },
          ].map(({ label, value, icon: Icon, color }) => (
            <button
              key={label}
              onClick={() => setFilter(filter === label.toLowerCase().replace(" ", "_") ? "all" : label.toLowerCase().replace(" ", "_"))}
              className={`bg-card border rounded-lg p-3 text-left hover:border-primary/30 transition ${filter === label.toLowerCase().replace(" ", "_") ? "border-primary/50" : "border-border"}`}
            >
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Icon size={14} className={color} /> {label}
              </div>
              <div className={`text-lg font-bold ${color}`}>{value}</div>
            </button>
          ))}
        </div>
      )}

      {/* Confirmation list */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No confirmations found.</div>
        ) : (
          filtered.map((c) => (
            <div key={c.id} className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded border font-medium ${RISK_COLORS[c.riskLevel]}`}>
                      {c.riskLevel.toUpperCase()}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLORS[c.status]}`}>
                      {c.status.replace("_", " ")}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                  <div className="mt-2 font-mono text-sm text-foreground truncate">{c.transactionId}</div>
                  <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
                    <span><strong>{c.asset}</strong> {c.amount.toLocaleString()}</span>
                    <span className="flex items-center gap-1">
                      <ArrowUpRight size={12} className={c.direction === "OUT" ? "text-red-400" : "text-emerald-400"} />
                      {c.direction}
                    </span>
                    {c.account && <span>Account: {c.account}</span>}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                    {c.slackNotifiedAt && <span className="text-blue-400">Slack notified</span>}
                    {c.emailNotifiedAt && <span className="text-purple-400">Email sent</span>}
                    {c.expiresAt && (
                      <span className={new Date(c.expiresAt) < new Date() ? "text-red-400" : "text-muted-foreground"}>
                        Expires: {formatDistanceToNow(new Date(c.expiresAt), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                  {c.escalationReason && (
                    <div className="mt-1 text-xs text-red-400">Reason: {c.escalationReason}</div>
                  )}
                </div>

                {/* Actions */}
                {c.status === "pending" && (
                  <div className="flex flex-col gap-1.5">
                    {(c.riskLevel === "low" || c.riskLevel === "medium") && (
                      <button
                        onClick={() => handleAction(c.id, "acknowledge")}
                        className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-md flex items-center gap-1"
                      >
                        <CheckCircle2 size={12} /> Acknowledge
                      </button>
                    )}
                    {(c.riskLevel === "high" || c.riskLevel === "critical") && (
                      <button
                        onClick={() => handleAction(c.id, "sign_off")}
                        className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-md flex items-center gap-1"
                      >
                        <ShieldCheck size={12} /> Sign Off
                      </button>
                    )}
                    <button
                      onClick={() => handleAction(c.id, "escalate")}
                      className="px-3 py-1.5 text-xs bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-md flex items-center gap-1"
                    >
                      <AlertTriangle size={12} /> Escalate
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
