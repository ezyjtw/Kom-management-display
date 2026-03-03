"use client";

import {
  ArrowUpRight,
  ArrowDownLeft,
  Minus,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  UserX,
  ExternalLink,
  FileSearch,
} from "lucide-react";
import type { TravelRuleReconciliationRow, TravelRuleMatchStatus } from "@/types";
import { formatDistanceToNow } from "date-fns";

interface ReconciliationTableProps {
  rows: TravelRuleReconciliationRow[];
  onOpenCase?: (row: TravelRuleReconciliationRow) => void;
  caseIds?: Record<string, string>; // transactionId → caseId
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
  if (!addr || addr.length <= 16) return addr || "\u2014";
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

function MatchStatusBadge({ status }: { status: TravelRuleMatchStatus }) {
  switch (status) {
    case "matched":
      return (
        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">
          <CheckCircle2 size={12} /> Matched
        </span>
      );
    case "unmatched":
      return (
        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 font-semibold animate-pulse">
          <XCircle size={12} /> No Travel Rule
        </span>
      );
    case "missing_originator":
      return (
        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-semibold">
          <UserX size={12} /> Missing Originator
        </span>
      );
    case "missing_beneficiary":
      return (
        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 font-semibold">
          <AlertTriangle size={12} /> Missing Beneficiary
        </span>
      );
  }
}

export function ReconciliationTable({ rows, onOpenCase, caseIds }: ReconciliationTableProps) {
  if (rows.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-8 text-center text-muted-foreground">
        No transactions to reconcile.
      </div>
    );
  }

  // Sort: urgent (unmatched, missing_*) first
  const priorityOrder: Record<TravelRuleMatchStatus, number> = {
    unmatched: 0,
    missing_originator: 1,
    missing_beneficiary: 2,
    matched: 3,
  };
  const sorted = [...rows].sort(
    (a, b) => priorityOrder[a.matchStatus] - priorityOrder[b.matchStatus],
  );

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                Compliance
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                Dir
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                Asset
              </th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                Amount
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                Originator
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                Beneficiary
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                Notabene
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                Created
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                Tx Hash
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const isUrgent = row.matchStatus !== "matched";
              return (
                <tr
                  key={row.transactionId}
                  className={`border-b border-border last:border-0 transition-colors ${
                    isUrgent
                      ? "bg-red-500/5 hover:bg-red-500/10"
                      : "hover:bg-muted/20"
                  }`}
                >
                  <td className="px-4 py-3">
                    <MatchStatusBadge status={row.matchStatus} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <DirectionIcon direction={row.direction} />
                      <span className="text-xs font-medium">
                        {row.direction}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-foreground">
                      {row.asset}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {row.amount.toLocaleString(undefined, {
                      maximumFractionDigits: 8,
                    })}
                  </td>
                  <td className="px-4 py-3">
                    {row.hasOriginator ? (
                      <div>
                        <span className="text-xs font-medium text-foreground">
                          {row.originatorName}
                        </span>
                        <span
                          className="block font-mono text-xs text-muted-foreground"
                          title={row.senderAddress}
                        >
                          {truncateAddress(row.senderAddress)}
                        </span>
                      </div>
                    ) : (
                      <div>
                        <span
                          className={`text-xs ${
                            row.matchStatus === "missing_originator"
                              ? "text-amber-400 font-semibold"
                              : "text-muted-foreground"
                          }`}
                        >
                          {row.matchStatus === "unmatched"
                            ? "\u2014"
                            : "MISSING"}
                        </span>
                        <span
                          className="block font-mono text-xs text-muted-foreground"
                          title={row.senderAddress}
                        >
                          {truncateAddress(row.senderAddress)}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.hasBeneficiary ? (
                      <div>
                        <span className="text-xs font-medium text-foreground">
                          {row.beneficiaryName}
                        </span>
                        <span
                          className="block font-mono text-xs text-muted-foreground"
                          title={row.receiverAddress}
                        >
                          {truncateAddress(row.receiverAddress)}
                        </span>
                      </div>
                    ) : (
                      <div>
                        <span
                          className={`text-xs ${
                            row.matchStatus === "missing_beneficiary"
                              ? "text-orange-400 font-semibold"
                              : "text-muted-foreground"
                          }`}
                        >
                          {row.matchStatus === "unmatched"
                            ? "\u2014"
                            : "MISSING"}
                        </span>
                        <span
                          className="block font-mono text-xs text-muted-foreground"
                          title={row.receiverAddress}
                        >
                          {truncateAddress(row.receiverAddress)}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.notabeneTransferId ? (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-md ${
                          row.notabeneStatus === "ACCEPTED"
                            ? "bg-emerald-500/10 text-emerald-400"
                            : row.notabeneStatus === "REJECTED"
                              ? "bg-red-500/10 text-red-400"
                              : "bg-muted/50 text-muted-foreground"
                        }`}
                      >
                        {row.notabeneStatus}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        \u2014
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock size={12} />
                      <span className="text-xs">
                        {formatDistanceToNow(new Date(row.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {row.txHash ? (
                      <span
                        className="font-mono text-xs text-muted-foreground flex items-center gap-1"
                        title={row.txHash}
                      >
                        {row.txHash.slice(0, 10)}...
                        <ExternalLink size={10} />
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        \u2014
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isUrgent && onOpenCase && (
                      caseIds?.[row.transactionId] ? (
                        <a
                          href={`/travel-rule/case/${caseIds[row.transactionId]}`}
                          className="text-xs px-2.5 py-1 bg-blue-500/10 text-blue-400 rounded hover:bg-blue-500/20 inline-flex items-center gap-1"
                        >
                          <FileSearch size={12} />
                          View Case
                        </a>
                      ) : (
                        <button
                          onClick={() => onOpenCase(row)}
                          className="text-xs px-2.5 py-1 bg-primary text-primary-foreground rounded hover:bg-primary/90 inline-flex items-center gap-1"
                        >
                          <FileSearch size={12} />
                          Open Case
                        </button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
