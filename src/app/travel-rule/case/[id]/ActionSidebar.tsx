"use client";

import {
  User,
  UserPlus,
  Mail,
  Send,
  Zap,
  RefreshCw,
  CheckCircle2,
  Clock,
  Activity,
  MessageSquare,
  FileText,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface VaspContact {
  id: string;
  vaspDid: string;
  vaspName: string;
  email: string;
}

interface ActionSidebarProps {
  caseData: {
    ownerName: string | null;
    ownerUserId: string | null;
    status: string;
    matchStatus: string;
    createdAt: string;
    slaDeadline: string | null;
  };
  isResolved: boolean;
  employees: Array<{ id: string; name: string }>;
  vaspContacts: VaspContact[];
  activities: any[];
  // Assignment
  showAssign: boolean;
  assignTo: string;
  onToggleAssign: (show: boolean) => void;
  onAssignToChange: (value: string) => void;
  onAssign: () => void;
  // Email
  showSendEmail: boolean;
  emailTo: string;
  emailName: string;
  loadingPreview: boolean;
  onToggleSendEmail: (show: boolean) => void;
  onEmailToChange: (value: string) => void;
  onEmailNameChange: (value: string) => void;
  onSelectVasp: (contact: VaspContact) => void;
  onPreviewEmail: () => void;
  // API Approval
  showApproveApi: boolean;
  requestId: string;
  submittingApproval: boolean;
  onToggleApproveApi: (show: boolean) => void;
  onRequestIdChange: (value: string) => void;
  onApproveApi: () => void;
  // Recheck
  recheckLoading: boolean;
  onRecheckNotabene: () => void;
  // Resolve
  showResolve: boolean;
  resolutionType: string;
  resolutionNote: string;
  onToggleResolve: (show: boolean) => void;
  onResolutionTypeChange: (value: string) => void;
  onResolutionNoteChange: (value: string) => void;
  onResolve: () => void;
  // Notes
  noteContent: string;
  addingNote: boolean;
  onNoteContentChange: (value: string) => void;
  onAddNote: () => void;
}

export function ActionSidebar(props: ActionSidebarProps) {
  const { caseData, isResolved, employees, vaspContacts, activities } = props;

  return (
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
            {props.showAssign ? (
              <div className="space-y-2">
                <select
                  value={props.assignTo}
                  onChange={(e) => props.onAssignToChange(e.target.value)}
                  className="w-full text-sm border border-border rounded px-2 py-1.5"
                >
                  <option value="">Select person...</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button onClick={props.onAssign} className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90">
                    Assign
                  </button>
                  <button onClick={() => props.onToggleAssign(false)} className="text-xs px-3 py-1.5 border border-border rounded hover:bg-accent/50">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => props.onToggleAssign(true)}
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
          <h3 className="text-sm font-semibold text-foreground mb-3">Resolution Actions</h3>
          <div className="space-y-2">
            {/* API Approval */}
            {props.showApproveApi ? (
              <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                <p className="text-xs font-medium text-foreground">Approve via Komainu API</p>
                <p className="text-xs text-muted-foreground">Enter the Komainu request ID to approve this transaction via API.</p>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Request ID</label>
                  <input
                    value={props.requestId}
                    onChange={(e) => props.onRequestIdChange(e.target.value)}
                    placeholder="req_..."
                    className="w-full text-sm border border-border rounded px-2 py-1.5 font-mono"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={props.onApproveApi}
                    disabled={!props.requestId.trim() || props.submittingApproval}
                    className="text-xs px-3 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-500 disabled:opacity-50 flex items-center gap-1"
                  >
                    <Zap size={12} />
                    {props.submittingApproval ? "Submitting..." : "Submit Approval"}
                  </button>
                  <button onClick={() => props.onToggleApproveApi(false)} className="text-xs px-3 py-1.5 border border-border rounded hover:bg-accent/50">
                    Cancel
                  </button>
                </div>
              </div>
            ) : caseData.status !== "AwaitingApproval" ? (
              <button
                onClick={() => props.onToggleApproveApi(true)}
                className="w-full text-xs px-3 py-2 border border-purple-500/30 text-purple-400 rounded-lg hover:bg-purple-500/10 flex items-center justify-center gap-1.5"
              >
                <Zap size={14} />
                Approve via API
              </button>
            ) : null}

            {/* Recheck Notabene */}
            <button
              onClick={props.onRecheckNotabene}
              disabled={props.recheckLoading}
              className="w-full text-xs px-3 py-2 border border-blue-500/30 text-blue-400 rounded-lg hover:bg-blue-500/10 flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw size={14} className={props.recheckLoading ? "animate-spin" : ""} />
              {props.recheckLoading ? "Rechecking..." : "Recheck Notabene"}
            </button>

            {/* Send email */}
            {props.showSendEmail ? (
              <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                <p className="text-xs font-medium text-foreground">Send Travel Rule Email</p>
                {vaspContacts.length > 0 && (
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">From VASP directory</label>
                    <select
                      onChange={(e) => {
                        const c = vaspContacts.find((v) => v.id === e.target.value);
                        if (c) props.onSelectVasp(c);
                      }}
                      className="w-full text-sm border border-border rounded px-2 py-1.5"
                    >
                      <option value="">Select VASP contact...</option>
                      {vaspContacts.map((c) => (
                        <option key={c.id} value={c.id}>{c.vaspName} ({c.email})</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Recipient email</label>
                  <input
                    value={props.emailTo}
                    onChange={(e) => props.onEmailToChange(e.target.value)}
                    placeholder="compliance@counterparty.com"
                    className="w-full text-sm border border-border rounded px-2 py-1.5"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Recipient name (optional)</label>
                  <input
                    value={props.emailName}
                    onChange={(e) => props.onEmailNameChange(e.target.value)}
                    placeholder="Compliance Team"
                    className="w-full text-sm border border-border rounded px-2 py-1.5"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={props.onPreviewEmail}
                    disabled={!props.emailTo || props.loadingPreview}
                    className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
                  >
                    <Send size={12} />
                    {props.loadingPreview ? "Loading..." : "Preview Email"}
                  </button>
                  <button onClick={() => props.onToggleSendEmail(false)} className="text-xs px-3 py-1.5 border border-border rounded hover:bg-accent/50">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => props.onToggleSendEmail(true)}
                className="w-full text-xs px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 flex items-center justify-center gap-1.5"
              >
                <Mail size={14} />
                Send Travel Rule Email
              </button>
            )}

            {/* Resolve */}
            {props.showResolve ? (
              <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                <p className="text-xs font-medium text-foreground">Mark as Resolved</p>
                <select
                  value={props.resolutionType}
                  onChange={(e) => props.onResolutionTypeChange(e.target.value)}
                  className="w-full text-sm border border-border rounded px-2 py-1.5"
                >
                  <option value="info_obtained">Information Obtained</option>
                  <option value="email_sent">Resolved via Email</option>
                  <option value="not_required">Travel Rule Not Required</option>
                  <option value="escalated">Escalated</option>
                </select>
                <textarea
                  value={props.resolutionNote}
                  onChange={(e) => props.onResolutionNoteChange(e.target.value)}
                  placeholder="Resolution notes..."
                  className="w-full text-sm border border-border rounded px-2 py-1.5 h-20"
                />
                <div className="flex gap-2">
                  <button onClick={props.onResolve} className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-500 flex items-center gap-1">
                    <CheckCircle2 size={12} />
                    Resolve
                  </button>
                  <button onClick={() => props.onToggleResolve(false)} className="text-xs px-3 py-1.5 border border-border rounded hover:bg-accent/50">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => props.onToggleResolve(true)}
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

        {!isResolved && (
          <div className="mb-4">
            <textarea
              value={props.noteContent}
              onChange={(e) => props.onNoteContentChange(e.target.value)}
              placeholder="Add a note..."
              className="w-full text-sm border border-border rounded-lg px-3 py-2 h-16 resize-none"
            />
            <button
              onClick={props.onAddNote}
              disabled={!props.noteContent.trim() || props.addingNote}
              className="mt-1 text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
            >
              <MessageSquare size={12} />
              {props.addingNote ? "Adding..." : "Add Note"}
            </button>
          </div>
        )}

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
  );
}
