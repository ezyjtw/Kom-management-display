"use client";

import { useEffect, useState } from "react";
import { Upload } from "lucide-react";

interface TemplateRow {
  id: string;
  source: string;
  purpose: string;
  confirmId: string;
  status: "ready" | "template_not_defined";
}

export default function ImportsPage() {
  const [rows, setRows] = useState<TemplateRow[]>([]);

  useEffect(() => {
    fetch("/api/admin/imports")
      .then((r) => r.json())
      .then((json) => { if (json.success) setRows(json.data); })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2"><Upload size={22} /> Imports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          File imports for sources without an API in Phase 1. Each template is built from a real export before it can be used.
        </p>
      </div>
      <div className="bg-card border border-border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b border-border">
              <th className="px-4 py-2">Source</th><th className="px-4 py-2">Purpose</th><th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-b border-border/50">
                <td className="px-4 py-2 font-medium text-foreground">{t.source}</td>
                <td className="px-4 py-2">{t.purpose}</td>
                <td className="px-4 py-2 text-xs">
                  {t.status === "ready" ? "Ready" : <>Template not defined yet: waiting on <span className="font-mono">{t.confirmId}</span></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
