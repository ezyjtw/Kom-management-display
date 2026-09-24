"use client";

/** RLS, asset realisation and return of assets (spec §12 CHK-09K). RESTRICTED: realisation:view only. */

import { useEffect, useState } from "react";
import { Lock, AlertTriangle, ExternalLink } from "lucide-react";
import { formatUsd } from "@/lib/decimal";

interface RealisationCase {
  id: string;
  title: string;
  ticketKey: string | null;
  ticketUrl: string | null;
  state: string;
  exposureUsd: string | null;
  clockStartedAt: string;
  riskCommitteeThresholdAlert: boolean;
}

export default function RealisationPage() {
  const [data, setData] = useState<{ cases: RealisationCase[]; notice: string } | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    void fetch("/api/realisations").then(async (r) => {
      if (r.status === 403) { setDenied(true); return; }
      const json = await r.json();
      if (json.success) setData(json.data);
    });
  }, []);

  if (denied) return <p className="text-sm text-muted-foreground flex items-center gap-2"><Lock size={16} /> Restricted: this view requires realisation:view.</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2"><Lock size={22} className="text-primary" /> RLS realisations and returns (restricted)</h1>
      {data && <p role="note" className="p-3 rounded-lg text-sm bg-amber-500/10 text-amber-400 border border-amber-500/20 flex gap-2"><AlertTriangle size={16} className="shrink-0" /> {data.notice}</p>}
      <table className="w-full text-sm bg-card rounded-xl border border-border">
        <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-4 py-2">Case</th><th>Ticket</th><th>State</th><th>USD</th><th>Opened</th><th /></tr></thead>
        <tbody>
          {(data?.cases ?? []).map((c) => (
            <tr key={c.id} className="border-t border-border/50">
              <td className="px-4 py-2">{c.title}</td>
              <td className="text-xs">{c.ticketUrl ? <a href={c.ticketUrl} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1">{c.ticketKey} <ExternalLink size={10} /></a> : c.ticketKey ?? "—"}</td>
              <td className="text-xs">{c.state}</td>
              <td className="text-xs">{formatUsd(c.exposureUsd)}</td>
              <td className="text-xs">{new Date(c.clockStartedAt).toLocaleDateString()}</td>
              <td className="text-xs">{c.riskCommitteeThresholdAlert && <span className="text-red-400">Above Risk Committee threshold, no approval link</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
