import { AlertTriangle } from "lucide-react";

/** Shown until every active SLA policy has a target (CONFIRM-SLA-TARGETS). */
export function SlaTargetsBanner({ codes }: { codes: string[] }) {
  if (codes.length === 0) return null;
  return (
    <div role="status" className="bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 text-sm px-4 py-2 rounded-lg flex items-start gap-2">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span>
        <strong>SLA targets not set</strong> for {codes.length} {codes.length === 1 ? "policy" : "policies"} ({codes.join(", ")}).
        SLA alerts and attainment stay off for these until an admin sets them.
      </span>
    </div>
  );
}
