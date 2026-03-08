"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldAlert, AlertTriangle, CheckCircle2 } from "lucide-react";
import { EmailPreviewPanel } from "./EmailPreviewPanel";
import { ActionSidebar } from "./ActionSidebar";
import { StatusBanners } from "./StatusBanners";

/** Strip dangerous tags/attributes from HTML to prevent XSS */
function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const dangerous = doc.querySelectorAll("script, iframe, object, embed, form, link[rel=import]");
  dangerous.forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith("on") || attr.value.startsWith("javascript:")) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return doc.body.innerHTML;
}

function truncateAddress(addr: string): string {
  if (!addr || addr.length <= 20) return addr || "\u2014";
  return `${addr.slice(0, 10)}...${addr.slice(-8)}`;
}

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

export default function CaseDetailPage() {
  const params = useParams();
  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [employees, setEmployees] = useState<Array<{ id: string; name: string }>>([]);
  const [vaspContacts, setVaspContacts] = useState<VaspContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [activities, setActivities] = useState<any[]>([]);

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
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewSubject, setPreviewSubject] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [showApproveApi, setShowApproveApi] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [submittingApproval, setSubmittingApproval] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [approvalRequestId, setApprovalRequestId] = useState("");
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

  async function refreshCase() {
    const fresh = await fetch(`/api/travel-rule/cases/${params.id}`).then((r) => r.json());
    if (fresh.success) setCaseData(fresh.data);
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
          if (empJson.success) setEmployees(empJson.data.map((e: any) => ({ id: e.id, name: e.name })));
          if (vaspJson.success) setVaspContacts(vaspJson.data);
          if (actJson.success) setActivities(actJson.data);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [params.id]);

  async function handleAssign() {
    if (!assignTo) return;
    const res = await fetch(`/api/travel-rule/cases/${params.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ownerUserId: assignTo }) });
    const json = await res.json();
    if (json.success) await refreshCase();
    setShowAssign(false);
    setAssignTo("");
  }

  async function handlePreviewEmail() {
    if (!emailTo) return;
    setLoadingPreview(true);
    const res = await fetch(`/api/travel-rule/cases/${params.id}/preview-email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipientEmail: emailTo, recipientName: emailName }) });
    const json = await res.json();
    setLoadingPreview(false);
    if (json.success) { setPreviewHtml(json.data.html); setPreviewSubject(json.data.subject); }
  }

  async function handleConfirmSendEmail() {
    if (!emailTo) return;
    setSending(true);
    const res = await fetch(`/api/travel-rule/cases/${params.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send_email", recipientEmail: emailTo, recipientName: emailName }) });
    const json = await res.json();
    setSending(false);
    if (json.success) { setPreviewHtml(null); setShowSendEmail(false); await refreshCase(); }
  }

  async function handleResolve() {
    const res = await fetch(`/api/travel-rule/cases/${params.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Resolved", resolutionType, resolutionNote }) });
    const json = await res.json();
    if (json.success) await refreshCase();
    setShowResolve(false);
  }

  async function handleAddNote() {
    if (!noteContent.trim()) return;
    setAddingNote(true);
    const res = await fetch(`/api/travel-rule/cases/${params.id}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: noteContent }) });
    const json = await res.json();
    setAddingNote(false);
    if (json.success) { setNoteContent(""); fetchActivity(); }
  }

  async function handleApproveApi() {
    if (!requestId.trim()) return;
    setSubmittingApproval(true);
    try {
      const res = await fetch(`/api/travel-rule/cases/${params.id}/approve-api`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId }) });
      const json = await res.json();
      if (json.success) { setApprovalRequestId(requestId); setShowApproveApi(false); setRequestId(""); await refreshCase(); fetchActivity(); }
    } catch (err) { console.error("API approval failed:", err); }
    finally { setSubmittingApproval(false); }
  }

  async function handleCheckApprovalStatus() {
    setCheckingStatus(true);
    try {
      const res = await fetch(`/api/travel-rule/cases/${params.id}/approve-api`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check_status", requestId: approvalRequestId }) });
      const json = await res.json();
      if (json.success) { await refreshCase(); fetchActivity(); }
    } catch (err) { console.error("Status check failed:", err); }
    finally { setCheckingStatus(false); }
  }

  async function handleRecheckNotabene() {
    setRecheckLoading(true);
    setRecheckResult(null);
    try {
      const res = await fetch(`/api/travel-rule/cases/${params.id}/recheck`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const json = await res.json();
      if (json.success) { setRecheckResult(json.data); await refreshCase(); fetchActivity(); }
    } catch (err) { console.error("Notabene recheck failed:", err); }
    finally { setRecheckLoading(false); }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading case...</div>;
  if (!caseData) return (
    <div className="text-center py-12">
      <p className="text-muted-foreground">Case not found</p>
      <Link href="/travel-rule" className="text-primary hover:underline mt-2 inline-block">Back to Travel Rule</Link>
    </div>
  );

  const isResolved = caseData.status === "Resolved";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/travel-rule" className="text-muted-foreground hover:text-foreground"><ArrowLeft size={20} /></Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <ShieldAlert size={22} className="text-primary" />
            Travel Rule Case
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{caseData.asset} {caseData.direction} — {caseData.transactionId}</p>
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
          {/* Compliance Status */}
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
                <p className="text-xs text-muted-foreground mt-1">Both originator and beneficiary information are present in Notabene. This case can be resolved.</p>
              </div>
            ) : (
              <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-lg">
                <p className="text-sm font-semibold text-red-400">{MATCH_LABELS[caseData.matchStatus] || caseData.matchStatus}</p>
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
            <h3 className="text-sm font-semibold text-foreground mb-3">Transaction Details</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-xs text-muted-foreground block">Transaction ID</span>
                <span className="font-mono text-foreground">{caseData.transactionId}</span>
              </div>
              {caseData.txHash && (
                <div>
                  <span className="text-xs text-muted-foreground block">Tx Hash</span>
                  <span className="font-mono text-foreground" title={caseData.txHash}>{truncateAddress(caseData.txHash)}</span>
                </div>
              )}
              <div>
                <span className="text-xs text-muted-foreground block">Direction</span>
                <span className="text-foreground">{caseData.direction === "IN" ? "Inbound" : caseData.direction === "OUT" ? "Outbound" : caseData.direction}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Asset / Amount</span>
                <span className="font-mono text-foreground">{caseData.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })} {caseData.asset}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Originator Address</span>
                <span className="font-mono text-foreground" title={caseData.senderAddress}>{caseData.senderAddress || <span className="text-red-400">Missing</span>}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Beneficiary Address</span>
                <span className="font-mono text-foreground" title={caseData.receiverAddress}>{caseData.receiverAddress || <span className="text-red-400">Missing</span>}</span>
              </div>
              {caseData.notabeneTransferId && (
                <div className="col-span-2">
                  <span className="text-xs text-muted-foreground block">Notabene Transfer</span>
                  <span className="font-mono text-foreground">{caseData.notabeneTransferId}</span>
                </div>
              )}
            </div>
          </div>

          {/* Email Preview */}
          {previewHtml && (
            <EmailPreviewPanel
              previewHtml={previewHtml}
              previewSubject={previewSubject}
              emailTo={emailTo}
              emailName={emailName}
              sending={sending}
              sanitizeHtml={sanitizeHtml}
              onConfirmSend={handleConfirmSendEmail}
              onEdit={() => setPreviewHtml(null)}
              onDiscard={() => { setPreviewHtml(null); setShowSendEmail(false); }}
            />
          )}

          {/* Status banners */}
          <StatusBanners
            caseData={caseData}
            recheckResult={recheckResult}
            checkingStatus={checkingStatus}
            onCheckApprovalStatus={handleCheckApprovalStatus}
            onDismissRecheck={() => setRecheckResult(null)}
          />
        </div>

        {/* Sidebar */}
        <ActionSidebar
          caseData={caseData}
          isResolved={isResolved}
          employees={employees}
          vaspContacts={vaspContacts}
          activities={activities}
          showAssign={showAssign}
          assignTo={assignTo}
          onToggleAssign={setShowAssign}
          onAssignToChange={setAssignTo}
          onAssign={handleAssign}
          showSendEmail={showSendEmail}
          emailTo={emailTo}
          emailName={emailName}
          loadingPreview={loadingPreview}
          onToggleSendEmail={setShowSendEmail}
          onEmailToChange={setEmailTo}
          onEmailNameChange={setEmailName}
          onSelectVasp={(c) => { setEmailTo(c.email); setEmailName(c.vaspName); }}
          onPreviewEmail={handlePreviewEmail}
          showApproveApi={showApproveApi}
          requestId={requestId}
          submittingApproval={submittingApproval}
          onToggleApproveApi={setShowApproveApi}
          onRequestIdChange={setRequestId}
          onApproveApi={handleApproveApi}
          recheckLoading={recheckLoading}
          onRecheckNotabene={handleRecheckNotabene}
          showResolve={showResolve}
          resolutionType={resolutionType}
          resolutionNote={resolutionNote}
          onToggleResolve={setShowResolve}
          onResolutionTypeChange={setResolutionType}
          onResolutionNoteChange={setResolutionNote}
          onResolve={handleResolve}
          noteContent={noteContent}
          addingNote={addingNote}
          onNoteContentChange={setNoteContent}
          onAddNote={handleAddNote}
        />
      </div>
    </div>
  );
}
