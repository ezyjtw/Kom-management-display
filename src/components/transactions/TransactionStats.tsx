"use client";

import { ArrowUpDown, Clock, FileCheck, AlertTriangle } from "lucide-react";
import type { KomainuPendingTransaction, KomainuPendingRequest } from "@/types";

interface TransactionStatsProps {
  transactions: KomainuPendingTransaction[];
  requests: KomainuPendingRequest[];
}

export function TransactionStats({ transactions, requests }: TransactionStatsProps) {
  const totalPendingTx = transactions.length;
  const totalPendingReq = requests.length;
  const uniqueAssets = [...new Set(transactions.map((tx) => tx.asset))].length;
  const expiringSoon = requests.filter((req) => {
    const expiryTime = new Date(req.expires_at).getTime();
    const oneHour = 60 * 60 * 1000;
    return expiryTime - Date.now() < oneHour;
  }).length;

  const stats = [
    {
      label: "Pending Transactions",
      value: totalPendingTx,
      icon: ArrowUpDown,
      color: "text-blue-400 bg-blue-500/10",
    },
    {
      label: "Pending Approvals",
      value: totalPendingReq,
      icon: FileCheck,
      color: "text-purple-400 bg-purple-500/10",
    },
    {
      label: "Assets Involved",
      value: uniqueAssets,
      icon: Clock,
      color: "text-emerald-400 bg-emerald-500/10",
    },
    {
      label: "Expiring Soon",
      value: expiringSoon,
      icon: AlertTriangle,
      color: expiringSoon > 0 ? "text-amber-400 bg-amber-500/10" : "text-muted-foreground bg-muted/50",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div key={stat.label} className="bg-card rounded-xl border border-border p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="text-2xl font-bold mt-1">{stat.value}</p>
              </div>
              <div className={`p-3 rounded-xl ${stat.color}`}>
                <Icon size={22} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
