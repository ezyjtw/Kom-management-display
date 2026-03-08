"use client";

import { Clock, Shield, CheckCircle2, ArrowDownRight, ArrowUpRight, AlertCircle } from "lucide-react";

interface Summary {
  total: number;
  active: number;
  awaitingCheckerApproval: number;
  completed: number;
  feeBufferLow: boolean;
  totalOnrampVolume: number;
  totalOfframpVolume: number;
}

function formatUsd(val: number) {
  return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function RampSummaryCards({ summary }: { summary: Summary }) {
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="bg-card rounded-xl border border-border p-3">
          <div className="flex items-center gap-2 mb-1">
            <Clock size={14} className="text-amber-400" />
            <span className="text-xs text-muted-foreground">Active</span>
          </div>
          <p className="text-lg font-bold text-foreground">{summary.active}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-3">
          <div className="flex items-center gap-2 mb-1">
            <Shield size={14} className="text-purple-400" />
            <span className="text-xs text-muted-foreground">Awaiting Checker</span>
          </div>
          <p className="text-lg font-bold text-purple-400">{summary.awaitingCheckerApproval}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-3">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 size={14} className="text-emerald-400" />
            <span className="text-xs text-muted-foreground">Completed</span>
          </div>
          <p className="text-lg font-bold text-emerald-400">{summary.completed}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-3">
          <div className="flex items-center gap-2 mb-1">
            <ArrowDownRight size={14} className="text-emerald-400" />
            <span className="text-xs text-muted-foreground">Onramp Vol.</span>
          </div>
          <p className="text-sm font-bold text-foreground">${formatUsd(summary.totalOnrampVolume)}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-3">
          <div className="flex items-center gap-2 mb-1">
            <ArrowUpRight size={14} className="text-blue-400" />
            <span className="text-xs text-muted-foreground">Offramp Vol.</span>
          </div>
          <p className="text-sm font-bold text-foreground">${formatUsd(summary.totalOfframpVolume)}</p>
        </div>
      </div>

      {summary.feeBufferLow && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-center gap-3">
          <AlertCircle size={18} className="text-amber-400 shrink-0" />
          <p className="text-sm text-amber-400">Fee buffer is running low — proprietary buffer needs top-up to cover bank/issuer fees.</p>
        </div>
      )}
    </>
  );
}
