"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  Send,
  X,
  Check,
  AlertTriangle,
  MessageSquare,
  Mail,
  Hash,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface IncidentSummary {
  id: string;
  title: string;
  provider: string;
  severity: string;
  status: string;
}

interface CommsDraft {
  id: string;
  incidentId: string;
  clientImpactRecordId: string;
  clientName: string;
  aiDraft: string;
  finalMessage: string;
  sendChannel: string;
  sendChannelId: string;
  status: string;
  approvedByEmployeeId: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  deliveryStatus: string;
  deliveryError: string;
  createdAt: string;
}

interface GroupedDrafts {
  incident: IncidentSummary;
  drafts: CommsDraft[];
}

type ViewTab = "drafts" | "sent";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/10 text-red-400",
  high: "bg-orange-500/10 text-orange-400",
  medium: "bg-amber-500/10 text-amber-400",
  low: "bg-muted text-muted-foreground",
};

export default function ClientCommsPage() {
  const [groups, setGroups] = useState<GroupedDrafts[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ViewTab>("drafts");
  const [expandedIncident, setExpandedIncident] = useState<string | null>(null);
  const [editedMessages, setEditedMessages] = useState<Record<string, string>>({});
  const [approveModal, setApproveModal] = useState<CommsDraft | null>(null);
  const [recipientToggles, setRecipientToggles] = useState<Record<string, boolean>>({});
  const [sending, setSending] = useState<string | null>(null);

  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = activeTab === "drafts" ? "draft" : "sent";
      const res = await fetch(`/api/client-comms?status=${status}`);
      const json = await res.json();
      if (json.success) {
        setGroups(json.data || []);
      } else {
        setError(json.error || "Failed to load drafts");
      }
    } catch (err) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  async function handleApprove(draft: CommsDraft) {
    const finalMessage = editedMessages[draft.id] || draft.finalMessage || draft.aiDraft;

    // Build recipients from draft
    const recipients = [];
    if (draft.sendChannel === "slack" && draft.sendChannelId) {
      recipients.push({ channel: "slack" as const, address: draft.sendChannelId });
    }
    if (draft.sendChannel === "email" && draft.sendChannelId) {
      recipients.push({ channel: "email" as const, address: draft.sendChannelId });
    }

    // Open approve modal with recipient toggles
    setApproveModal(draft);
    const toggles: Record<string, boolean> = {};
    for (const r of recipients) {
      toggles[`${r.channel}:${r.address}`] = true;
    }
    setRecipientToggles(toggles);
  }

  async function confirmApprove() {
    if (!approveModal) return;
    const draft = approveModal;
    const finalMessage = editedMessages[draft.id] || draft.finalMessage || draft.aiDraft;

    const recipients = Object.entries(recipientToggles)
      .filter(([, enabled]) => enabled)
      .map(([key]) => {
        const [channel, ...addressParts] = key.split(":");
        return { channel: channel as "slack" | "email", address: addressParts.join(":") };
      });

    if (recipients.length === 0) return;

    setSending(draft.id);
    try {
      const res = await fetch(`/api/client-comms/${draft.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalMessage, recipients }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || "Failed to send");
      }
    } catch {
      setError("Network error during send");
    } finally {
      setSending(null);
      setApproveModal(null);
      fetchDrafts();
    }
  }

  async function handleDismiss(draftId: string) {
    try {
      await fetch(`/api/client-comms/${draftId}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Dismissed by operator" }),
      });
      fetchDrafts();
    } catch {
      setError("Failed to dismiss");
    }
  }

  const totalDrafts = groups.reduce((acc, g) => acc + g.drafts.length, 0);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Client Communications</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Review and approve AI-drafted client notifications
          </p>
        </div>
        <button
          onClick={fetchDrafts}
          className="flex items-center gap-2 px-3 py-2 text-sm text-foreground bg-card border border-border rounded-lg hover:bg-accent/50 self-start sm:self-auto"
        >
          <RefreshCw size={16} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-400 flex items-center gap-2">
          <AlertTriangle size={16} />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-xs hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-card border border-border rounded-xl p-1">
        <button
          onClick={() => setActiveTab("drafts")}
          className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors ${
            activeTab === "drafts"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent/50"
          }`}
        >
          <MessageSquare size={16} />
          Pending Drafts
          {activeTab !== "drafts" && totalDrafts > 0 && (
            <span className="bg-amber-500 text-white text-xs px-1.5 py-0.5 rounded-full">
              {totalDrafts}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("sent")}
          className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors ${
            activeTab === "sent"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent/50"
          }`}
        >
          <Send size={16} />
          Sent
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center text-muted-foreground">
          <RefreshCw size={24} className="mx-auto mb-3 animate-spin" />
          Loading...
        </div>
      ) : groups.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <MessageSquare size={32} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">
            {activeTab === "drafts" ? "No pending drafts" : "No sent communications"}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.incident.id} className="bg-card rounded-xl border border-border overflow-hidden">
              {/* Incident header */}
              <button
                onClick={() =>
                  setExpandedIncident(
                    expandedIncident === group.incident.id ? null : group.incident.id,
                  )
                }
                className="w-full flex items-center justify-between p-4 hover:bg-accent/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {expandedIncident === group.incident.id ? (
                    <ChevronUp size={16} />
                  ) : (
                    <ChevronDown size={16} />
                  )}
                  <div className="text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {group.incident.title}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          SEVERITY_COLORS[group.incident.severity] || "bg-muted text-muted-foreground"
                        }`}
                      >
                        {group.incident.severity}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {group.incident.provider} &middot; {group.drafts.length} client
                      {group.drafts.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
              </button>

              {/* Draft cards */}
              {(expandedIncident === group.incident.id || groups.length === 1) && (
                <div className="border-t border-border divide-y divide-border">
                  {group.drafts.map((draft) => (
                    <div key={draft.id} className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {draft.clientName}
                          </span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${
                              draft.sendChannel === "slack"
                                ? "bg-purple-500/10 text-purple-400"
                                : "bg-blue-500/10 text-blue-400"
                            }`}
                          >
                            {draft.sendChannel === "slack" ? (
                              <Hash size={10} />
                            ) : (
                              <Mail size={10} />
                            )}
                            {draft.sendChannel}
                          </span>
                          {draft.deliveryStatus === "delivered" && (
                            <span className="text-xs text-emerald-400 flex items-center gap-1">
                              <Check size={10} /> Delivered
                            </span>
                          )}
                          {draft.deliveryStatus === "failed" && (
                            <span className="text-xs text-red-400 flex items-center gap-1">
                              <X size={10} /> Failed
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(draft.createdAt).toLocaleString()}
                        </span>
                      </div>

                      {/* Editable textarea for drafts */}
                      {activeTab === "drafts" ? (
                        <textarea
                          value={
                            editedMessages[draft.id] !== undefined
                              ? editedMessages[draft.id]
                              : draft.finalMessage || draft.aiDraft
                          }
                          onChange={(e) =>
                            setEditedMessages((prev) => ({
                              ...prev,
                              [draft.id]: e.target.value,
                            }))
                          }
                          rows={4}
                          className="w-full bg-background border border-border rounded-lg p-3 text-sm text-foreground resize-y"
                          placeholder="Draft message..."
                        />
                      ) : (
                        <p className="text-sm text-foreground/80 bg-muted/30 rounded-lg p-3">
                          {draft.finalMessage || draft.aiDraft || "(empty)"}
                        </p>
                      )}

                      {draft.deliveryError && (
                        <p className="text-xs text-red-400">Error: {draft.deliveryError}</p>
                      )}

                      {/* Actions for drafts */}
                      {activeTab === "drafts" && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleApprove(draft)}
                            disabled={sending === draft.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500/20 disabled:opacity-50"
                          >
                            {sending === draft.id ? (
                              <RefreshCw size={14} className="animate-spin" />
                            ) : (
                              <Send size={14} />
                            )}
                            Approve & Send
                          </button>
                          <button
                            onClick={() => handleDismiss(draft.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-muted text-muted-foreground rounded-lg hover:bg-accent/50"
                          >
                            <X size={14} />
                            Dismiss
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Approve Modal */}
      {approveModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl p-6 max-w-lg w-full space-y-4">
            <h3 className="text-lg font-semibold text-foreground">Confirm Send</h3>
            <p className="text-sm text-muted-foreground">
              Send notification to <strong>{approveModal.clientName}</strong>?
            </p>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Recipients</p>
              {Object.entries(recipientToggles).map(([key, enabled]) => {
                const [channel, ...addr] = key.split(":");
                return (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) =>
                        setRecipientToggles((prev) => ({
                          ...prev,
                          [key]: e.target.checked,
                        }))
                      }
                      className="rounded"
                    />
                    <span className="text-foreground">
                      {channel === "slack" ? "#" : ""}{addr.join(":")}
                    </span>
                    <span className="text-xs text-muted-foreground">({channel})</span>
                  </label>
                );
              })}
            </div>

            <div className="bg-muted/30 rounded-lg p-3 text-sm text-foreground/80 max-h-40 overflow-y-auto">
              {editedMessages[approveModal.id] || approveModal.finalMessage || approveModal.aiDraft}
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setApproveModal(null)}
                className="px-4 py-2 text-sm bg-muted text-muted-foreground rounded-lg hover:bg-accent/50"
              >
                Cancel
              </button>
              <button
                onClick={confirmApprove}
                disabled={Object.values(recipientToggles).every((v) => !v)}
                className="px-4 py-2 text-sm bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50 flex items-center gap-1.5"
              >
                <Send size={14} />
                Send Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
