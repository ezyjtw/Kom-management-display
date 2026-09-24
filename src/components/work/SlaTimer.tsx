"use client";

/**
 * Live SLA countdown (spec §14.4). Ticks every second from the server's due
 * time; turns to "breached" when the due time passes. Business-hours clocks
 * show "paused" outside business hours.
 */
import { useEffect, useState } from "react";
import type { SlaStatus } from "@/modules/work-items/queue";

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function formatDuration(ms: number): string {
  const s = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}

const CLOCK: Record<string, string> = { ownership: "own", first_response: "respond", resolution: "resolve" };

/** Current display state: the server state, promoted to breach once the due time passes. */
export function liveState(sla: SlaStatus, now: number): SlaStatus["state"] {
  if (sla.dueAt && Date.parse(sla.dueAt) <= now) return "breach";
  return sla.state;
}

export function SlaTimer({ sla, now }: { sla: SlaStatus; now: number }) {
  if (!sla.dueAt || !sla.clock) return <span className="text-xs text-muted-foreground">no SLA</span>;
  const left = Date.parse(sla.dueAt) - now;
  const state = liveState(sla, now);
  const cls = state === "breach" ? "text-red-500" : state === "warn" ? "text-amber-500" : "text-emerald-500";
  return (
    <span className={`text-xs font-mono tabular-nums ${cls}`} title={`${sla.clock.replace("_", " ")} clock, target ${sla.targetMins} min${sla.paused ? " (paused outside business hours)" : ""}`}>
      {left <= 0 ? `+${formatDuration(left)} over` : formatDuration(left)} <span className="text-muted-foreground">{CLOCK[sla.clock]}</span>
      {sla.paused && <span className="ml-1 text-muted-foreground">(paused)</span>}
    </span>
  );
}
