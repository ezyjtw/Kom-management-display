"use client";

import { ArrowUpRight, ArrowDownLeft, Minus, Clock, ExternalLink } from "lucide-react";
import type { KomainuPendingTransaction } from "@/types";
import { formatDistanceToNow } from "date-fns";

interface PendingTransactionsTableProps {
  transactions: KomainuPendingTransaction[];
}

function DirectionIcon({ direction }: { direction: string }) {
  switch (direction) {
    case "IN":
      return <ArrowDownLeft size={14} className="text-emerald-400" />;
    case "OUT":
      return <ArrowUpRight size={14} className="text-red-400" />;
    default:
      return <Minus size={14} className="text-muted-foreground" />;
  }
}

function truncateAddress(addr: string): string {
  if (!addr || addr.length <= 16) return addr || "—";
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

export function PendingTransactionsTable({ transactions }: PendingTransactionsTableProps) {
  if (transactions.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-8 text-center text-muted-foreground">
        No pending transactions found.
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Direction</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Asset</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Amount</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Fees</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">From</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">To</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Created</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Tx Hash</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <DirectionIcon direction={tx.direction} />
                    <span className="text-xs font-medium">{tx.direction}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="font-semibold text-foreground">{tx.asset}</span>
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  {tx.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                </td>
                <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                  {tx.fees > 0 ? tx.fees.toLocaleString(undefined, { maximumFractionDigits: 8 }) : "—"}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground" title={tx.sender_address}>
                  {truncateAddress(tx.sender_address)}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground" title={tx.receiver_address}>
                  {truncateAddress(tx.receiver_address)}
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs bg-muted/50 px-2 py-0.5 rounded-md">
                    {tx.transaction_type.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Clock size={12} />
                    <span className="text-xs">
                      {formatDistanceToNow(new Date(tx.created_at), { addSuffix: true })}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {tx.tx_hash ? (
                    <span className="font-mono text-xs text-muted-foreground flex items-center gap-1" title={tx.tx_hash}>
                      {tx.tx_hash.slice(0, 10)}...
                      <ExternalLink size={10} />
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
