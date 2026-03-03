"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ShieldAlert,
  User,
  Mail,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Send,
  UserPlus,
  Eye,
  MessageSquare,
  FileText,
  Activity,
  Zap,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface CaseData {
  id: string;
  transactionId: string;
  txHash: string;
  direction: string;
  asset: string;
  amount: number;
  senderAddress: string;
  receiverAddress: string;
  matchStatus: string;
  notabeneTransferId: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  status: string;
  resolutionType: string | null;
  resolutionNote: string;
  emailSentTo: string | null;
  emailSentAt: string | null;
  slaDeadline: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

interface VaspContact {
  id: string;
  vaspDid: string;
  vaspName: string;
  email: string;
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

const MATCH_LABELS: Record<string, string> = {
  unmatched: "No Travel Rule Data",
  missing_originator: "Missing Originator",
  missing_beneficiary: "Missing Beneficiary",
};

function truncateAddress(addr: string): string {
  if (!addr || addr.length <= 20) return addr || "\u2014";
  return `${addr.slice(0, 10)}...${addr.slice(-8)}`;
}

export default function CaseDetailPage() {
  const params = useParams();
  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [employees, setEmployees] = useState<Array<{ id: string; name: string }>>([]);
  const [vaspContacts, setVaspContacts] = useState<VaspContact[]>([]);
  const [loading, setLoading] = useState(true);

  // Action state
  const [showAssign, setShowAssign] = useState(false);
  const [assignTo, setAssignTo] = useState("");
  const [showSendEmail, setShowSendEmail] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailName, setEmailName] = useState("");
  const [sending, setSending] = useState(false);
  const [showResolve, setShowResolve] = useState(false);
  const [resolutionType, setResolutionType] = useState("info_obtained");
  const [resolutionNote, setResolutionNote] = useState("");

  // Email preview / approval state
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewSubject, setPreviewSubject] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Activity feed state
  const [activities, setActivities] = useState<any[]>([]);
  const [noteContent, setNoteContent] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  // API approval state
  const [showApproveApi, setShowApproveApi] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [submittingApproval, setSubmittingApproval] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [approvalRequestId, setApprovalRequestId] = useState(""); // stored after submit

  // Recheck Notabene state
  const [recheckLoading, setRecheckLoading] = useState(false);
  const [recheckResult, setRecheckResult] = useState<{
    previousMatchStatus: string;
    newMatchStatus: string;
    improved: boolean;
    canAutoResolve: boolean;
    originatorName: string | null;
    beneficiaryName: string | null;
  } | null>(null);

  function fetchActivity() {
    fetch(`/api/travel-rule/cases/${params.id}/activity`)
      .then((r) => r.json())
      .then((json) => { if (json.success) setActivities(json.data); })
      .catch(console.error);
  }

  useEffect(() => {
    if (params.id) {
      Promise.all([
        fetch(`/api/travel-rule/cases/${params.id}`).then((r) => r.json()),
        fetch("/api/employees").then((r) => r.json()),
        fetch("/api/travel-rule/vasp-directory").then((r) => r.json()),
        fetch(`/api/travel-rule/cases/${params.id}/activity`).then((r) => r.json()),
      ])
        .then(([caseJson, empJson, vaspJson, actJson]) => {
          if (caseJson.success) setCaseData(caseJson.data);
          if (empJson.success) {
            setEmployees(empJson.data.map((e: any) => ({ id: e.id, name: e.name })));
          }
          if (vaspJson.success) setVaspContacts(vaspJson.data);
          if (actJson.success) setActivities(actJson.data);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [params.id]);

  async function handleAssign() {
    if (!assignTo) return;
    const res = await fetch(`/api/travel-rule/cases/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerUserId: assignTo }),
    });
    const json = await res.json();
    if (json.success) {
      const fresh = await fetch(`/api/travel-rule/cases/${params.id}`).then((r) => r.json());
      if (fresh.success) setCaseData(fresh.data);
    }
    setShowAssign(false);
    setAssignTo("");
  }

  async function handlePreviewEmail() {
    if (!emailTo) return;
    setLoadingPreview(true);
    const res = await fetch(`/api/travel-rule/cases/${params.id}/preview-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipientEmail: emailTo,
        recipientName: emailName,
      }),
    });
    const json = await res.json();
    setLoadingPreview(false);
    if (json.success) {
      setPreviewHtml(json.data.html);
      setPreviewSubject(json.data.subject);
    }
  }

  async function handleConfirmSendEmail() {
    if (!emailTo) return;
    setSending(true);
    const res = await fetch(`/api/travel-rule/cases/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "send_email",
        recipientEmail: emailTo,
        recipientName: emailName,
      }),
    });
    const json = await res.json();
    setSending(false);
    if (json.success) {
      setPreviewHtml(null);
      setShowSendEmail(false);
      const fresh = await fetch(`/api/travel-rule/cases/${params.id}`).then((r) => r.json());
      if (fresh.success) setCaseData(fresh.data);
    }
  }

  async function handleResolve() {
    const res = await fetch(`/api/travel-rule/cases/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "Resolved",
        resolutionType,
        resolutionNote,
      }),
    });
    const json = await res.json();
    if (json.success) {
      const fresh = await fetch(`/api/travel-rule/cases/${params.id}`).then((r) => r.json());
      if (fresh.success) setCaseData(fresh.data);
    }
    setShowResolve(false);
  }

  async function handleAddNote() {
    if (!noteContent.trim()) return;
    setAddingNote(true);
    const res = await fetch(`/api/travel-rule/cases/${params.id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: noteContent }),
    });
    const json = await res.json();
    setAddingNote(false);
    if (json.success) {
      setNoteContent("");
      fetchActivity();
    }
  }

  async function handleApproveApi() {
    if (!requestId.trim()) return;
    setSubmittingApproval(true);
    try {
      const res = await fetch(`/api/travel-rule/cases/${params.id}/approve-api`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      });
      const json = await res.json();
      if (json.success) {
        setApprovalRequestId(requestId);
        setShowApproveApi(false);
        setRequestId("");
        const fresh = await fetch(`/api/travel-rule/cases/${params.id}`).then((r) => r.json());
        if (fresh.success) setCaseData(fresh.data);
        fetchActivity();
      }
    } catch (err) {
      console.error("API approval failed:", err);
    } finally {
      setSubmittingApproval(false);
    }
  }

  async function handleCheckApprovalStatus() {
    setCheckingStatus(true);
    try {
      const res = await fetch(`/api/travel-rule/cases/${params.id}/approve-api`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check_status", requestId: approvalRequestId }),
      });
      const json = await res.json();
      if (json.success) {
        const fresh = await fetch(`/api/travel-rule/cases/${params.id}`).then((r) => r.json());
        if (fresh.success) setCaseData(fresh.data);
        fetchActivity();
      }
    } catch (err) {
      console.error("Status check failed:", err);
    } finally {
      setCheckingStatus(false);
    }
  }

  async function handleRecheckNotabene() {
    setRecheckLoading(true);
    setRecheckResult(null);
    try {
      const res = await fetch(`/api/travel-rule/cases/${params.id}/recheck`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (json.success) {
        setRecheckResult(json.data);
        // Refresh case data if status changed
        const fresh = await fetch(`/api/travel-rule/cases/${params.id}`).then((r) => r.json());
        if (fresh.success) setCaseData(fresh.data);
        fetchActivity();
      }
    } catch (err) {
      console.error("Notabene recheck failed:", err);
    } finally {
      setRecheckLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Loading case...
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Case not found</p>
        <Link href="/travel-rule" className="text-primary hover:underline mt-2 inline-block">
          Back to Travel Rule
        </Link>
      </div>
    );
  }

  const isResolved = caseData.status === "Resolved";

  return (
    <div className="space-y-6">
      {/* Header */}
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
            {caseData.asset} {caseData.direction} — {caseData.transactionId}
          </p>
        </div>
        <span className={`text-xs px-3 py-1 rounded-full font-medium ${STATUS_COLORS[caseData.status] || "bg-muted text-muted-foreground"}`}>
          {STATUS_LABELS[caseData.status] || caseData.status}
        </span>
        {!isResolved && (() => {
          const hours = (Date.now() - new Date(caseData.createdAt).getTime()) / 3_600_000;
          const label = hours < 1 ? `${Math.round(hours * 60)}m` : hours < 24 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
          const color = hours < 24 ? "bg-emerald-500/10 text-emerald-400" : hours < 48 ? "bg-amber-500/10 text-amber-400" : "bg-red-500/10 text-red-400 font-semibold";
          return <span className={`text-xs px-2.5 py-1 rounded-full ${color}`}>{label} old</span>;
        })()}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-4">
          {/* Compliance Issue / Match Status */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              {caseData.matchStatus === "matched" ? (
                <><CheckCircle2 size={16} className="text-emerald-400" /> Compliance Status</>
              ) : (
                <><AlertTriangle size={16} className="text-red-400" /> Compliance Issue</>
              )}
            </h3>
            {caseData.matchStatus === "matched" ? (
              <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
                <p className="text-sm font-semibold text-emerald-400">Travel Rule Data Complete</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Both originator and beneficiary information are present in Notabene. This case can be resolved.
                </p>
              </div>
            ) : (
              <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-lg">
                <p className="text-sm font-semibold text-red-400">
                  {MATCH_LABELS[caseData.matchStatus] || caseData.matchStatus}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {caseData.matchStatus === "unmatched"
                    ? "This transaction has no corresponding travel rule transfer in Notabene. Either request the information from the counterparty or send a travel rule message via email."
                    : caseData.matchStatus === "missing_originator"
                      ? "A Notabene transfer exists but the originator details are missing or incomplete. Contact the originating VASP to obtain the required information."
                      : "A Notabene transfer exists but the beneficiary details are missing or incomplete. Contact the beneficiary VASP to obtain the required information."}
                </p>
              </div>
            )}
          </div>

          {/* Transaction details */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3">
              Transaction Details
            </h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-xs text-muted-foreground block">Transaction ID</span>
                <span className="font-mono text-foreground">{caseData.transactionId}</span>
              </div>
              {caseData.txHash && (
                <div>
                  <span className="text-xs text-muted-foreground block">Tx Hash</span>
                  <span className="font-mono text-foreground" title={caseData.txHash}>
                    {truncateAddress(caseData.txHash)}
                  </span>
                </div>
              )}
              <div>
                <span className="text-xs text-muted-foreground block">Direction</span>
                <span className="text-foreground">{caseData.direction === "IN" ? "Inbound" : caseData.direction === "OUT" ? "Outbound" : caseData.direction}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Asset / Amount</span>
                <span className="font-mono text-foreground">
                  {caseData.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })} {caseData.asset}
                </span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Originator Address</span>
                <span className="font-mono text-foreground" title={caseData.senderAddress}>
                  {caseData.senderAddress || <span className="text-red-400">Missing</span>}
                </span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Beneficiary Address</span>
                <span className="font-mono text-foreground" title={caseData.receiverAddress}>
                  {caseData.receiverAddress || <span className="text-red-400">Missing</span>}
                </span>
              </div>
              {caseData.notabeneTransferId && (
                <div className="col-span-2">
                  <span className="text-xs text-muted-foreground block">Notabene Transfer</span>
                  <span className="font-mono text-foreground">{caseData.notabeneTransferId}</span>
                </div>
              )}
            </div>
          </div>

          {/* Email preview — 4-eyes approval */}
          {previewHtml && (
            <div className="bg-card rounded-xl border-2 border-amber-500/40 p-5">
              <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
                <Eye size={16} className="text-amber-400" />
                Email Preview — Review Before Sending
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                To: <span className="font-medium text-foreground">{emailTo}</span>
                {emailName && <> ({emailName})</>}
                {" "}&middot; Subject: <span className="font-medium text-foreground">{previewSubject}</span>
              </p>
              <div
                className="border border-border rounded-lg bg-white p-4 max-h-[500px] overflow-y-auto text-black"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
              <div className="flex items-center gap-3 mt-4 pt-3 border-t border-border">
                <button
                  onClick={handleConfirmSendEmail}
                  disabled={sending}
                  className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5 font-medium"
                >
                  <Send size={14} />
                  {sending ? "Sending..." : "Approve & Send"}
                </button>
                <button
                  onClick={() => setPreviewHtml(null)}
                  className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-accent/50"
                >
                  Edit
                </button>
                <button
                  onClick={() => { setPreviewHtml(null); setShowSendEmail(false); }}
                  className="px-4 py-2 text-sm text-red-400 hover:text-red-300"
                >
                  Discard
                </button>
                <span className="ml-auto text-xs text-amber-400 flex items-center gap-1">
                  <AlertTriangle size={12} />
                  Requires human approval before sending
                </span>
              </div>
            </div>
          )}

          {/* Email sent */}
          {caseData.emailSentTo && (
            <div className="bg-card rounded-xl border border-border p-5">
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <Mail size={16} />
                Email Sent
              </h3>
              <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg text-sm">
                <p>
                  Sent to <span className="font-medium">{caseData.emailSentTo}</span>
                </p>
                {caseData.emailSentAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(caseData.emailSentAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Awaiting API Approval banner */}
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
                onClick={handleCheckApprovalStatus}
                disabled={checkingStatus}
                className="text-xs px-3 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-500 disabled:opacity-50 flex items-center gap-1"
              >
                <RefreshCw size={12} className={checkingStatus ? "animate-spin" : ""} />
                {checkingStatus ? "Checking..." : "Check Status"}
              </button>
            </div>
          )}

          {/* Notabene Recheck result */}
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
              <button
                onClick={() => setRecheckResult(null)}
                className="text-xs text-muted-foreground hover:text-foreground mt-2"
              >
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
        </div>

        {/* Sidebar — actions */}
        <div className="space-y-4">
          {/* Owner */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <User size={16} />
              Assigned To
            </h3>
            <p className="text-sm font-medium text-foreground mb-2">
              {caseData.ownerName || "Unassigned"}
            </p>
            {!isResolved && (
              <>
                {showAssign ? (
                  <div className="space-y-2">
                    <select
                      value={assignTo}
                      onChange={(e) => setAssignTo(e.target.value)}
                      className="w-full text-sm border border-border rounded px-2 py-1.5"
                    >
                      <option value="">Select person...</option>
                      {employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <button
                        onClick={handleAssign}
                        className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90"
                      >
                        Assign
                      </button>
                      <button
                        onClick={() => setShowAssign(false)}
                        className="text-xs px-3 py-1.5 border border-border rounded hover:bg-accent/50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowAssign(true)}
                    className="text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-accent/50 flex items-center gap-1 w-full justify-center"
                  >
                    <UserPlus size={12} />
                    {caseData.ownerUserId ? "Reassign" : "Assign Owner"}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Actions */}
          {!isResolved && (
            <div className="bg-card rounded-xl border border-border p-5">
              <h3 className="text-sm font-semibold text-foreground mb-3">
                Resolution Actions
              </h3>
              <div className="space-y-2">
                {/* Approve via API */}
                {showApproveApi ? (
                  <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                    <p className="text-xs font-medium text-foreground">Approve via Komainu API</p>
                    <p className="text-xs text-muted-foreground">
                      Enter the Komainu request ID to approve this transaction via API.
                    </p>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">
                        Request ID
                      </label>
                      <input
                        value={requestId}
                        onChange={(e) => setRequestId(e.target.value)}
                        placeholder="req_..."
                        className="w-full text-sm border border-border rounded px-2 py-1.5 font-mono"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleApproveApi}
                        disabled={!requestId.trim() || submittingApproval}
                        className="text-xs px-3 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-500 disabled:opacity-50 flex items-center gap-1"
                      >
                        <Zap size={12} />
                        {submittingApproval ? "Submitting..." : "Submit Approval"}
                      </button>
                      <button
                        onClick={() => setShowApproveApi(false)}
                        className="text-xs px-3 py-1.5 border border-border rounded hover:bg-accent/50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : caseData.status !== "AwaitingApproval" ? (
                  <button
                    onClick={() => setShowApproveApi(true)}
                    className="w-full text-xs px-3 py-2 border border-purple-500/30 text-purple-400 rounded-lg hover:bg-purple-500/10 flex items-center justify-center gap-1.5"
                  >
                    <Zap size={14} />
                    Approve via API
                  </button>
                ) : null}

                {/* Recheck Notabene */}
                <button
                  onClick={handleRecheckNotabene}
                  disabled={recheckLoading}
                  className="w-full text-xs px-3 py-2 border border-blue-500/30 text-blue-400 rounded-lg hover:bg-blue-500/10 flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw size={14} className={recheckLoading ? "animate-spin" : ""} />
                  {recheckLoading ? "Rechecking..." : "Recheck Notabene"}
                </button>

                {/* Send email */}
                {showSendEmail ? (
                  <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                    <p className="text-xs font-medium text-foreground">Send Travel Rule Email</p>
                    {vaspContacts.length > 0 && (
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">
                          From VASP directory
                        </label>
                        <select
                          onChange={(e) => {
                            const c = vaspContacts.find((v) => v.id === e.target.value);
                            if (c) {
                              setEmailTo(c.email);
                              setEmailName(c.vaspName);
                            }
                          }}
                          className="w-full text-sm border border-border rounded px-2 py-1.5"
                        >
                          <option value="">Select VASP contact...</option>
                          {vaspContacts.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.vaspName} ({c.email})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">
                        Recipient email
                      </label>
                      <input
                        value={emailTo}
                        onChange={(e) => setEmailTo(e.target.value)}
                        placeholder="compliance@counterparty.com"
                        className="w-full text-sm border border-border rounded px-2 py-1.5"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">
                        Recipient name (optional)
                      </label>
                      <input
                        value={emailName}
                        onChange={(e) => setEmailName(e.target.value)}
                        placeholder="Compliance Team"
                        className="w-full text-sm border border-border rounded px-2 py-1.5"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handlePreviewEmail}
                        disabled={!emailTo || loadingPreview}
                        className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
                      >
                        <Send size={12} />
                        {loadingPreview ? "Loading..." : "Preview Email"}
                      </button>
                      <button
                        onClick={() => { setShowSendEmail(false); setPreviewHtml(null); }}
                        className="text-xs px-3 py-1.5 border border-border rounded hover:bg-accent/50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowSendEmail(true)}
                    className="w-full text-xs px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 flex items-center justify-center gap-1.5"
                  >
                    <Mail size={14} />
                    Send Travel Rule Email
                  </button>
                )}

                {/* Resolve */}
                {showResolve ? (
                  <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                    <p className="text-xs font-medium text-foreground">Mark as Resolved</p>
                    <select
                      value={resolutionType}
                      onChange={(e) => setResolutionType(e.target.value)}
                      className="w-full text-sm border border-border rounded px-2 py-1.5"
                    >
                      <option value="info_obtained">Information Obtained</option>
                      <option value="email_sent">Resolved via Email</option>
                      <option value="not_required">Travel Rule Not Required</option>
                      <option value="escalated">Escalated</option>
                    </select>
                    <textarea
                      value={resolutionNote}
                      onChange={(e) => setResolutionNote(e.target.value)}
                      placeholder="Resolution notes..."
                      className="w-full text-sm border border-border rounded px-2 py-1.5 h-20"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleResolve}
                        className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-500 flex items-center gap-1"
                      >
                        <CheckCircle2 size={12} />
                        Resolve
                      </button>
                      <button
                        onClick={() => setShowResolve(false)}
                        className="text-xs px-3 py-1.5 border border-border rounded hover:bg-accent/50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowResolve(true)}
                    className="w-full text-xs px-3 py-2 border border-emerald-500/30 text-emerald-400 rounded-lg hover:bg-emerald-500/10 flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle2 size={14} />
                    Mark Resolved
                  </button>
                )}
              </div>
            </div>
          )}

          {/* SLA Status */}
          {!isResolved && (
            <div className="bg-card rounded-xl border border-border p-5">
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <Clock size={16} />
                Case Aging
              </h3>
              {(() => {
                const hours = (Date.now() - new Date(caseData.createdAt).getTime()) / 3_600_000;
                const color = hours < 24 ? "text-emerald-400" : hours < 48 ? "text-amber-400" : "text-red-400";
                return (
                  <div>
                    <p className={`text-lg font-bold ${color}`}>
                      {hours < 1 ? `${Math.round(hours * 60)}m` : hours < 24 ? `${Math.round(hours)}h` : `${(hours / 24).toFixed(1)}d`}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Created {new Date(caseData.createdAt).toLocaleString()}
                    </p>
                    {caseData.slaDeadline && (
                      <p className="text-xs text-muted-foreground mt-1">
                        SLA Deadline: {new Date(caseData.slaDeadline).toLocaleString()}
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Activity Feed */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Activity size={16} />
              Activity
            </h3>

            {/* Add Note */}
            {!isResolved && (
              <div className="mb-4">
                <textarea
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="Add a note..."
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 h-16 resize-none"
                />
                <button
                  onClick={handleAddNote}
                  disabled={!noteContent.trim() || addingNote}
                  className="mt-1 text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
                >
                  <MessageSquare size={12} />
                  {addingNote ? "Adding..." : "Add Note"}
                </button>
              </div>
            )}

            {/* Feed */}
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {activities.length === 0 ? (
                <p className="text-xs text-muted-foreground">No activity yet.</p>
              ) : (
                activities.map((item: any) => {
                  const isNote = item.type === "note";
                  const icon = isNote ? <MessageSquare size={12} className="text-blue-400" />
                    : item.action === "travel_rule_email_sent" ? <Mail size={12} className="text-purple-400" />
                    : item.action === "travel_rule_case_created" ? <FileText size={12} className="text-emerald-400" />
                    : <Activity size={12} className="text-muted-foreground" />;

                  return (
                    <div key={item.id} className="flex gap-2 text-xs">
                      <div className="mt-0.5 shrink-0">{icon}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-foreground">
                          <span className="font-medium">{item.actorName}</span>
                          {" — "}
                          {isNote ? item.content : item.description}
                        </p>
                        <p className="text-muted-foreground mt-0.5">
                          {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
