"use client";

import { CheckCircle2, RefreshCw, Loader2, Mail } from "lucide-react";

interface RecheckResult {
  previousMatchStatus: string;
  newMatchStatus: string;
  improved: boolean;
  canAutoResolve: boolean;
  originatorName: string | null;
  beneficiaryName: string | null;
}

interface StatusBannersProps {
  caseData: {
    status: string;
    matchStatus: string;
    emailSentTo: string | null;
    emailSentAt: string | null;
    resolutionType: string | null;
    resolutionNote: string;
    resolvedAt: string | null;
  };
  recheckResult: RecheckResult | null;
  checkingStatus: boolean;
  onCheckApprovalStatus: () => void;
  onDismissRecheck: () => void;
}

const MATCH_LABELS: Record<string, string> = {
  unmatched: "No Travel Rule Data",
  missing_originator: "Missing Originator",
  missing_beneficiary: "Missing Beneficiary",
};

export function StatusBanners({
  caseData,
  recheckResult,
  checkingStatus,
  onCheckApprovalStatus,
  onDismissRecheck,
}: StatusBannersProps) {
  return (
    <>
      {/* Email sent */}
      {caseData.emailSentTo && (
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Mail size={16} />
            Email Sent
          </h3>
          <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg text-sm">
            <p>Sent to <span className="font-medium">{caseData.emailSentTo}</span></p>
            {caseData.emailSentAt && (
              <p className="text-xs text-muted-foreground mt-1">
                {new Date(caseData.emailSentAt).toLocaleString()}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Awaiting API Approval */}
      {caseData.status === "AwaitingApproval" && (
        <div className="bg-card rounded-xl border-2 border-purple-500/30 p-5">
          <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
            <Loader2 size={16} className="text-purple-400 animate-spin" />
            Awaiting API Approval
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            An API approval has been submitted for this transaction. The Komainu API is processing the request.
          </p>
          <button
            onClick={onCheckApprovalStatus}
            disabled={checkingStatus}
            className="text-xs px-3 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-500 disabled:opacity-50 flex items-center gap-1"
          >
            <RefreshCw size={12} className={checkingStatus ? "animate-spin" : ""} />
            {checkingStatus ? "Checking..." : "Check Status"}
          </button>
        </div>
      )}

      {/* Recheck result */}
      {recheckResult && (
        <div className={`bg-card rounded-xl border p-5 ${recheckResult.canAutoResolve ? "border-emerald-500/30" : "border-border"}`}>
          <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
            <RefreshCw size={16} />
            Notabene Recheck Result
          </h3>
          {recheckResult.improved ? (
            <div className={`p-3 rounded-lg text-sm ${recheckResult.canAutoResolve ? "bg-emerald-500/5 border border-emerald-500/20" : "bg-blue-500/5 border border-blue-500/20"}`}>
              <p className={`font-medium ${recheckResult.canAutoResolve ? "text-emerald-400" : "text-blue-400"}`}>
                {recheckResult.canAutoResolve
                  ? "Match found — travel rule data is now complete!"
                  : `Status improved: ${recheckResult.previousMatchStatus.replace(/_/g, " ")} → ${recheckResult.newMatchStatus.replace(/_/g, " ")}`}
              </p>
              {recheckResult.originatorName && (
                <p className="text-xs text-muted-foreground mt-1">Originator: {recheckResult.originatorName}</p>
              )}
              {recheckResult.beneficiaryName && (
                <p className="text-xs text-muted-foreground mt-1">Beneficiary: {recheckResult.beneficiaryName}</p>
              )}
              {recheckResult.canAutoResolve && (
                <p className="text-xs text-emerald-400 mt-2">
                  This case can now be resolved as &quot;Information Obtained&quot;.
                </p>
              )}
            </div>
          ) : (
            <div className="p-3 bg-muted/30 rounded-lg text-sm">
              <p className="text-muted-foreground">
                No change — match status remains &quot;{recheckResult.newMatchStatus.replace(/_/g, " ")}&quot;.
              </p>
            </div>
          )}
          <button onClick={onDismissRecheck} className="text-xs text-muted-foreground hover:text-foreground mt-2">
            Dismiss
          </button>
        </div>
      )}

      {/* Resolution */}
      {caseData.status === "Resolved" && (
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-400" />
            Resolution
          </h3>
          <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg text-sm">
            <p className="font-medium text-emerald-400">
              {caseData.resolutionType === "info_obtained" && "Information Obtained"}
              {caseData.resolutionType === "email_sent" && "Resolved via Email"}
              {caseData.resolutionType === "not_required" && "Travel Rule Not Required"}
              {caseData.resolutionType === "escalated" && "Escalated"}
            </p>
            {caseData.resolutionNote && (
              <p className="text-muted-foreground mt-1">{caseData.resolutionNote}</p>
            )}
            {caseData.resolvedAt && (
              <p className="text-xs text-muted-foreground mt-2">
                Resolved {new Date(caseData.resolvedAt).toLocaleString()}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
