"use client";

import { Send, AlertTriangle, Eye } from "lucide-react";

interface EmailPreviewPanelProps {
  previewHtml: string;
  previewSubject: string;
  emailTo: string;
  emailName: string;
  sending: boolean;
  sanitizeHtml: (html: string) => string;
  onConfirmSend: () => void;
  onEdit: () => void;
  onDiscard: () => void;
}

export function EmailPreviewPanel({
  previewHtml,
  previewSubject,
  emailTo,
  emailName,
  sending,
  sanitizeHtml,
  onConfirmSend,
  onEdit,
  onDiscard,
}: EmailPreviewPanelProps) {
  return (
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
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(previewHtml) }}
      />
      <div className="flex items-center gap-3 mt-4 pt-3 border-t border-border">
        <button
          onClick={onConfirmSend}
          disabled={sending}
          className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5 font-medium"
        >
          <Send size={14} />
          {sending ? "Sending..." : "Approve & Send"}
        </button>
        <button
          onClick={onEdit}
          className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-accent/50"
        >
          Edit
        </button>
        <button
          onClick={onDiscard}
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
  );
}
