"use client";

import { ExternalLink, FileText, GitBranch, AlertTriangle, CheckCircle } from "lucide-react";

interface EvidenceItem {
  type: string;
  label: string;
  link?: string;
  details?: string;
  severity?: string;
  status?: string;
}

interface EvidencePanelProps {
  category: string;
  evidence: EvidenceItem[];
  metadata?: Record<string, unknown>;
}

const categoryIcons: Record<string, typeof FileText> = {
  jira: GitBranch,
  confluence: FileText,
  asset_action: ExternalLink,
  mistake: AlertTriangle,
  positive: CheckCircle,
};

export function EvidencePanel({ category, evidence, metadata }: EvidencePanelProps) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h4 className="text-sm font-semibold text-slate-700 mb-3 capitalize">
        {category.replace("_", " ")} Evidence
      </h4>

      {/* Metrics summary from metadata */}
      {metadata && Object.keys(metadata).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          {Object.entries(metadata).map(([key, value]) => (
            <div key={key} className="bg-slate-50 rounded-lg p-2.5">
              <p className="text-xs text-slate-500 capitalize">{key.replace(/_/g, " ")}</p>
              <p className="text-sm font-semibold">{String(value)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Evidence list */}
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {evidence.map((item, i) => {
          const Icon = categoryIcons[item.type] || FileText;
          return (
            <div
              key={i}
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 text-sm"
            >
              <Icon size={16} className="text-slate-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-slate-800">{item.label}</span>
                {item.details && (
                  <span className="text-slate-500 ml-2">— {item.details}</span>
                )}
              </div>
              {item.severity && (
                <span
                  className={`text-xs px-1.5 py-0.5 rounded ${
                    item.severity === "high"
                      ? "bg-red-100 text-red-700"
                      : item.severity === "medium"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {item.severity}
                </span>
              )}
              {item.link && (
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:text-blue-700 flex-shrink-0"
                >
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
          );
        })}
        {evidence.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-4">
            No evidence items for this period
          </p>
        )}
      </div>
    </div>
  );
}
