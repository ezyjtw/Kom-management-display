"use client";

import { useState } from "react";
import {
  Mail,
  MessageCircle,
  User,
  Clock,
  Link2,
  FileText,
  ArrowRightLeft,
  AlertTriangle,
} from "lucide-react";
import { StatusBadge, PriorityBadge } from "@/components/shared/StatusBadge";
import { formatSlaRemaining } from "@/lib/sla";

interface Message {
  id: string;
  timestamp: string;
  authorName: string;
  authorType: string;
  bodySnippet: string;
  bodyLink: string;
  attachments: string;
}

interface OwnershipChangeRecord {
  id: string;
  changedAt: string;
  reason: string;
  handoverNote: string;
  oldOwner: { name: string } | null;
  newOwner: { name: string } | null;
  changedBy: { name: string };
}

interface ThreadNote {
  id: string;
  content: string;
  createdAt: string;
  author: { name: string };
}

interface ThreadDetailData {
  id: string;
  source: string;
  subject: string;
  clientOrPartnerTag: string;
  status: string;
  priority: string;
  queue: string;
  ownerUserId: string | null;
  owner: { id: string; name: string; email: string } | null;
  createdAt: string;
  lastMessageAt: string;
  lastActionAt: string | null;
  linkedRecords: string;
  messages: Message[];
  ownershipChanges: OwnershipChangeRecord[];
  notes: ThreadNote[];
  slaStatus: {
    ttoRemaining: number | null;
    ttfaRemaining: number | null;
    tslaRemaining: number | null;
    isTtoBreached: boolean;
    isTtfaBreached: boolean;
    isTslaBreached: boolean;
  };
}

interface ThreadDetailProps {
  thread: ThreadDetailData;
  employees: Array<{ id: string; name: string }>;
  onStatusChange: (status: string) => void;
  onOwnerChange: (ownerId: string | null, handoverNote: string) => void;
  onAddNote: (content: string) => void;
}

const STATUS_OPTIONS = [
  "Unassigned",
  "Assigned",
  "InProgress",
  "WaitingExternal",
  "WaitingInternal",
  "Done",
  "Closed",
];

export function ThreadDetail({
  thread,
  employees,
  onStatusChange,
  onOwnerChange,
  onAddNote,
}: ThreadDetailProps) {
  const [noteContent, setNoteContent] = useState("");
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferTo, setTransferTo] = useState("");
  const [handoverNote, setHandoverNote] = useState("");

  const SourceIcon = thread.source === "email" ? Mail : MessageCircle;

  function handleTransfer() {
    onOwnerChange(transferTo || null, handoverNote);
    setShowTransfer(false);
    setTransferTo("");
    setHandoverNote("");
  }

  function handleAddNote() {
    if (noteContent.trim()) {
      onAddNote(noteContent);
      setNoteContent("");
    }
  }

  let linkedRecords: Array<{ type: string; id: string; label: string }> = [];
  try {
    linkedRecords = JSON.parse(thread.linkedRecords || "[]");
  } catch {}

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Main content — messages */}
      <div className="lg:col-span-2 space-y-4">
        {/* Thread header */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-3">
            <SourceIcon
              size={20}
              className={thread.source === "email" ? "text-blue-500" : "text-purple-500"}
            />
            <h2 className="text-lg font-semibold text-slate-900">{thread.subject}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <PriorityBadge priority={thread.priority} />
            <StatusBadge status={thread.status} />
            {thread.clientOrPartnerTag && (
              <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs">
                {thread.clientOrPartnerTag}
              </span>
            )}
            <span className="text-slate-500 text-xs">Queue: {thread.queue}</span>
            <span className="text-slate-500 text-xs">
              Created {new Date(thread.createdAt).toLocaleString()}
            </span>
          </div>
        </div>

        {/* Messages */}
        <div className="space-y-3">
          {thread.messages.map((msg) => (
            <div
              key={msg.id}
              className={`bg-white rounded-xl border p-4 ${
                msg.authorType === "internal"
                  ? "border-blue-200 bg-blue-50/30"
                  : "border-slate-200"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <User size={14} className="text-slate-400" />
                  <span className="text-sm font-medium">
                    {msg.authorName}
                  </span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded ${
                      msg.authorType === "internal"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {msg.authorType}
                  </span>
                </div>
                <span className="text-xs text-slate-400">
                  {new Date(msg.timestamp).toLocaleString()}
                </span>
              </div>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{msg.bodySnippet}</p>
              {msg.bodyLink && (
                <a
                  href={msg.bodyLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-500 hover:underline mt-2 inline-block"
                >
                  View full message →
                </a>
              )}
            </div>
          ))}
          {thread.messages.length === 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400">
              No messages loaded yet
            </div>
          )}
        </div>

        {/* Internal notes */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <FileText size={16} />
            Internal Notes
          </h3>
          <div className="space-y-2 mb-4">
            {thread.notes.map((note) => (
              <div key={note.id} className="p-3 bg-slate-50 rounded-lg text-sm">
                <div className="flex justify-between mb-1">
                  <span className="font-medium text-slate-700">{note.author.name}</span>
                  <span className="text-xs text-slate-400">
                    {new Date(note.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-slate-600">{note.content}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="Add an internal note..."
              className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2"
              onKeyDown={(e) => e.key === "Enter" && handleAddNote()}
            />
            <button
              onClick={handleAddNote}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Add
            </button>
          </div>
        </div>
      </div>

      {/* Sidebar — controls */}
      <div className="space-y-4">
        {/* SLA Panel */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <Clock size={16} />
            SLA Timers
          </h3>
          <div className="space-y-3">
            {thread.slaStatus.ttoRemaining !== null && (
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">Time to Ownership</span>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    thread.slaStatus.isTtoBreached ? "sla-breach" : thread.slaStatus.ttoRemaining! < 30 ? "sla-warning" : "sla-ok"
                  }`}
                >
                  {formatSlaRemaining(thread.slaStatus.ttoRemaining)}
                </span>
              </div>
            )}
            {thread.slaStatus.ttfaRemaining !== null && (
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">Time to First Action</span>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    thread.slaStatus.isTtfaBreached ? "sla-breach" : thread.slaStatus.ttfaRemaining! < 30 ? "sla-warning" : "sla-ok"
                  }`}
                >
                  {formatSlaRemaining(thread.slaStatus.ttfaRemaining)}
                </span>
              </div>
            )}
            {thread.slaStatus.tslaRemaining !== null && (
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">Since Last Action</span>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    thread.slaStatus.isTslaBreached ? "sla-breach" : thread.slaStatus.tslaRemaining! < 30 ? "sla-warning" : "sla-ok"
                  }`}
                >
                  {formatSlaRemaining(thread.slaStatus.tslaRemaining)}
                </span>
              </div>
            )}
            {thread.slaStatus.ttoRemaining === null &&
              thread.slaStatus.ttfaRemaining === null &&
              thread.slaStatus.tslaRemaining === null && (
                <p className="text-xs text-slate-400">No active SLA timers</p>
              )}
          </div>
        </div>

        {/* Owner + Status Controls */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Owner & Status</h3>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Owner</label>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {thread.owner?.name || "Unassigned"}
                </span>
              </div>
              <div className="flex gap-2 mt-2">
                {!thread.ownerUserId && (
                  <button
                    onClick={() => setShowTransfer(true)}
                    className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    Take Ownership
                  </button>
                )}
                <button
                  onClick={() => setShowTransfer(true)}
                  className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1"
                >
                  <ArrowRightLeft size={12} />
                  Transfer
                </button>
              </div>
            </div>

            {showTransfer && (
              <div className="p-3 bg-slate-50 rounded-lg space-y-2">
                <select
                  value={transferTo}
                  onChange={(e) => setTransferTo(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded px-2 py-1.5"
                >
                  <option value="">Unassign</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}
                    </option>
                  ))}
                </select>
                <textarea
                  value={handoverNote}
                  onChange={(e) => setHandoverNote(e.target.value)}
                  placeholder="Handover note (recommended)..."
                  className="w-full text-sm border border-slate-200 rounded px-2 py-1.5 h-16"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleTransfer}
                    className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setShowTransfer(false)}
                    className="text-xs px-3 py-1.5 border border-slate-200 rounded hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="text-xs text-slate-500 block mb-1">Status</label>
              <select
                value={thread.status}
                onChange={(e) => onStatusChange(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/([A-Z])/g, " $1").trim()}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Linked Records */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <Link2 size={16} />
            Linked Records
          </h3>
          <div className="space-y-2">
            {linkedRecords.map((rec, i) => (
              <div key={i} className="flex items-center gap-2 text-sm p-2 bg-slate-50 rounded">
                <span className="text-xs bg-slate-200 px-1.5 py-0.5 rounded">{rec.type}</span>
                <span className="text-slate-700">{rec.label || rec.id}</span>
              </div>
            ))}
            {linkedRecords.length === 0 && (
              <p className="text-xs text-slate-400">No linked records</p>
            )}
          </div>
        </div>

        {/* Ownership History */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <ArrowRightLeft size={16} />
            Ownership History
          </h3>
          <div className="space-y-2">
            {thread.ownershipChanges.map((change) => (
              <div key={change.id} className="text-xs p-2 bg-slate-50 rounded">
                <div className="flex justify-between mb-1">
                  <span className="text-slate-600">
                    {change.oldOwner?.name || "Unassigned"} → {change.newOwner?.name || "Unassigned"}
                  </span>
                  <span className="text-slate-400">
                    {new Date(change.changedAt).toLocaleString()}
                  </span>
                </div>
                <span className="text-slate-500">by {change.changedBy.name}</span>
                {change.handoverNote && (
                  <p className="text-slate-600 mt-1 italic">"{change.handoverNote}"</p>
                )}
              </div>
            ))}
            {thread.ownershipChanges.length === 0 && (
              <p className="text-xs text-slate-400">No ownership changes</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
