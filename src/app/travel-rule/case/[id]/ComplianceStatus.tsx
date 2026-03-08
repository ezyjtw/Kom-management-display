"use client";

import { CheckCircle2, AlertTriangle } from "lucide-react";

interface ComplianceStatusProps {
  matchStatus: string;
}

const MATCH_LABELS: Record<string, string> = {
  unmatched: "No Travel Rule Data",
  missing_originator: "Missing Originator",
  missing_beneficiary: "Missing Beneficiary",
};

export default function ComplianceStatus({ matchStatus }: ComplianceStatusProps) {
  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        {matchStatus === "matched" ? (
          <><CheckCircle2 size={16} className="text-emerald-400" /> Compliance Status</>
        ) : (
          <><AlertTriangle size={16} className="text-red-400" /> Compliance Issue</>
        )}
      </h3>
      {matchStatus === "matched" ? (
        <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
          <p className="text-sm font-semibold text-emerald-400">Travel Rule Data Complete</p>
          <p className="text-xs text-muted-foreground mt-1">
            Both originator and beneficiary information are present in Notabene. This case can be resolved.
          </p>
        </div>
      ) : (
        <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-lg">
          <p className="text-sm font-semibold text-red-400">
            {MATCH_LABELS[matchStatus] || matchStatus}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {matchStatus === "unmatched"
              ? "This transaction has no corresponding travel rule transfer in Notabene. Either request the information from the counterparty or send a travel rule message via email."
              : matchStatus === "missing_originator"
                ? "A Notabene transfer exists but the originator details are missing or incomplete. Contact the originating VASP to obtain the required information."
                : "A Notabene transfer exists but the beneficiary details are missing or incomplete. Contact the beneficiary VASP to obtain the required information."}
          </p>
        </div>
      )}
    </div>
  );
}
