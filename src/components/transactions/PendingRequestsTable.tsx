"use client";

import { Clock, FileCheck, AlertCircle } from "lucide-react";
import type { KomainuPendingRequest } from "@/types";
import { formatDistanceToNow, format } from "date-fns";

interface PendingRequestsTableProps {
  requests: KomainuPendingRequest[];
}

function RequestTypeBadge({ type }: { type: string }) {
  const labels: Record<string, { label: string; color: string }> = {
    CREATE_TRANSACTION: { label: "Transaction", color: "bg-blue-500/10 text-blue-400" },
    COLLATERAL_OPERATION_OFFCHAIN: { label: "Collateral (Offchain)", color: "bg-purple-500/10 text-purple-400" },
    COLLATERAL_OPERATION_ONCHAIN: { label: "Collateral (Onchain)", color: "bg-amber-500/10 text-amber-400" },
  };
  const config = labels[type] || { label: type, color: "bg-muted/50 text-muted-foreground" };

  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${config.color}`}>
      {config.label}
    </span>
  );
}

function isExpiringSoon(expiresAt: string): boolean {
  const expiryTime = new Date(expiresAt).getTime();
  const oneHour = 60 * 60 * 1000;
  return expiryTime - Date.now() < oneHour;
}

export function PendingRequestsTable({ requests }: PendingRequestsTableProps) {
  if (requests.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-8 text-center text-muted-foreground">
        No pending requests awaiting approval.
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Entity</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Account</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Requested</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Expires</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((req) => (
              <tr key={req.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3">
                  <RequestTypeBadge type={req.type} />
                </td>
                <td className="px-4 py-3 text-foreground">
                  <div className="flex items-center gap-1.5">
                    <FileCheck size={14} className="text-muted-foreground" />
                    <span className="text-xs">{req.entity}</span>
                    {req.entity_id && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {req.entity_id.slice(0, 8)}...
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {req.account}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Clock size={12} />
                    <span className="text-xs">
                      {formatDistanceToNow(new Date(req.requested_at), { addSuffix: true })}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {isExpiringSoon(req.expires_at) && (
                      <AlertCircle size={12} className="text-amber-400" />
                    )}
                    <span className={`text-xs ${isExpiringSoon(req.expires_at) ? "text-amber-400 font-medium" : "text-muted-foreground"}`}>
                      {format(new Date(req.expires_at), "MMM d, HH:mm")}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1 text-xs font-medium bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-md">
                    <Clock size={10} />
                    {req.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
