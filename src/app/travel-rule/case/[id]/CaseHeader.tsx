"use client";

import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";

interface CaseHeaderProps {
  asset: string;
  direction: string;
  transactionId: string;
  status: string;
  createdAt: string;
  isResolved: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  Open: "Open",
  Investigating: "Investigating",
  PendingResponse: "Pending Response",
  AwaitingApproval: "Awaiting API Approval",
  Resolved: "Resolved",
};

const STATUS_COLORS: Record<string, string> = {
  Open: "bg-red-500/10 text-red-400",
  Investigating: "bg-blue-500/10 text-blue-400",
  PendingResponse: "bg-amber-500/10 text-amber-400",
  AwaitingApproval: "bg-purple-500/10 text-purple-400",
  Resolved: "bg-emerald-500/10 text-emerald-400",
};

export default function CaseHeader({ asset, direction, transactionId, status, createdAt, isResolved }: CaseHeaderProps) {
  return (
    <div className="flex items-center gap-4">
      <Link href="/travel-rule" className="text-muted-foreground hover:text-foreground">
        <ArrowLeft size={20} />
      </Link>
      <div className="flex-1">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <ShieldAlert size={22} className="text-primary" />
          Travel Rule Case
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {asset} {direction} — {transactionId}
        </p>
      </div>
      <span className={`text-xs px-3 py-1 rounded-full font-medium ${STATUS_COLORS[status] || "bg-muted text-muted-foreground"}`}>
        {STATUS_LABELS[status] || status}
      </span>
      {!isResolved && (() => {
        const hours = (Date.now() - new Date(createdAt).getTime()) / 3_600_000;
        const label = hours < 1 ? `${Math.round(hours * 60)}m` : hours < 24 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
        const color = hours < 24 ? "bg-emerald-500/10 text-emerald-400" : hours < 48 ? "bg-amber-500/10 text-amber-400" : "bg-red-500/10 text-red-400 font-semibold";
        return <span className={`text-xs px-2.5 py-1 rounded-full ${color}`}>{label} old</span>;
      })()}
    </div>
  );
}
