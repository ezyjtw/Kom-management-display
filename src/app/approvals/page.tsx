"use client";

import { useState, useEffect } from "react";
import { RefreshCw, AlertTriangle, UserCheck, Clock, CheckCircle2 } from "lucide-react";
import { RiskLevelBadge } from "@/components/shared/StatusBadge";
import { formatDistanceToNow } from "date-fns";

interface ApprovalItem {
  id: string;
  type: string;
  status: string;
  entity: string;
  requested_by: string;
  requested_at: string;
  expires_at: string;
  workspace: string;
  organization: string;
  account: string;
  ageMinutes: number;
  riskLevel: string;
  lane: string;
}

interface ApprovalsData {
  items: ApprovalItem[];
  summary: { total: number; autoApprove: number; opsApproval: number; complianceReview: number };
  configured: boolean;
}

const LANE_LABELS: Record<string, string> = {
  auto_approve: "Should Auto-Approve",
  ops_approval: "Ops Approval",
  compliance_review: "Compliance Review",
};

const LANE_COLORS: Record<string, string> = {
  auto_approve: "border-emerald-500/30",
  ops_approval: "border-blue-500/30",
  compliance_review: "border-red-500/30",
};

export default function ApprovalsPage() {
  const [data, setData] = useState<ApprovalsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch("/api/approvals");
      const json = await res.json();
      if (json.success) setData(json.data);
    } catch { /* */ } finally { setLoading(false); }
  }

  async function handleAction(requestId: string, action: string, riskLevel: string) {
    const notes = action !== "approved" ? prompt(`Notes for ${action}:`) || "" : "";
    await fetch("/api/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, action, riskLevel, notes }),
    });
    fetchData();
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground"><RefreshCw size={24} className="animate-spin mr-3" />Loading approvals...</div>;
  }

  if (!data) {
    return <div className="text-center py-12"><AlertTriangle size={24} className="mx-auto mb-3 text-red-400" /><p className="text-muted-foreground">Failed to load approvals.</p></div>;
  }

  if (!data.configured) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
          <UserCheck size={24} className="text-primary" /> Approvals Queue
        </h1>
        <div className="bg-card rounded-xl border border-border p-8 text-center">
          <UserCheck size={40} className="mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground">Komainu API not configured. Set KOMAINU_API_BASE_URL, KOMAINU_API_USER, and KOMAINU_API_SECRET to enable.</p>
        </div>
      </div>
    );
  }

  const lanes = ["auto_approve", "ops_approval", "compliance_review"];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <UserCheck size={24} className="text-primary" /> Approvals Queue
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">Pending requests categorized by risk level</p>
        </div>
        <button onClick={fetchData} className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground bg-card border border-border rounded-lg hover:bg-accent/50"><RefreshCw size={16} /></button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-card rounded-xl border border-border p-3">
          <p className="text-xs text-muted-foreground">Total Pending</p>
          <p className="text-xl font-bold text-foreground">{data.summary.total}</p>
        </div>
        {lanes.map((lane) => (
          <div key={lane} className="bg-card rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">{LANE_LABELS[lane]}</p>
            <p className="text-xl font-bold text-foreground">{data.items.filter((i) => i.lane === lane).length}</p>
          </div>
        ))}
      </div>

      {/* Swimlane view */}
      {data.summary.total === 0 ? (
        <div className="bg-card rounded-xl border border-border p-8 text-center">
          <CheckCircle2 size={32} className="mx-auto mb-2 text-emerald-400" />
          <p className="text-muted-foreground">No pending approvals</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {lanes.map((lane) => {
            const laneItems = data.items.filter((i) => i.lane === lane);
            return (
              <div key={lane} className={`bg-card rounded-xl border-2 ${LANE_COLORS[lane]} p-4`}>
                <h3 className="text-sm font-semibold text-foreground mb-3">{LANE_LABELS[lane]} ({laneItems.length})</h3>
                <div className="space-y-2">
                  {laneItems.map((item) => (
                    <div key={item.id} className="bg-background rounded-lg border border-border p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-foreground">{item.type.replace(/_/g, " ")}</span>
                        <RiskLevelBadge level={item.riskLevel} />
                      </div>
                      <p className="text-xs text-muted-foreground">{item.entity} &middot; {item.account}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock size={12} />
                        <span>{item.ageMinutes}m ago</span>
                        <span>&middot; expires {formatDistanceToNow(new Date(item.expires_at), { addSuffix: true })}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => handleAction(item.id, "approved", item.riskLevel)} className="px-2 py-1 text-xs bg-emerald-500/10 text-emerald-400 rounded hover:bg-emerald-500/20">Approve</button>
                        <button onClick={() => handleAction(item.id, "escalated", item.riskLevel)} className="px-2 py-1 text-xs bg-amber-500/10 text-amber-400 rounded hover:bg-amber-500/20">Escalate</button>
                        <button onClick={() => handleAction(item.id, "flagged_stuck", item.riskLevel)} className="px-2 py-1 text-xs bg-red-500/10 text-red-400 rounded hover:bg-red-500/20">Flag Stuck</button>
                      </div>
                    </div>
                  ))}
                  {laneItems.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Empty</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
