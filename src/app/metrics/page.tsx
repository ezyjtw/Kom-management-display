"use client";

/**
 * Metrics (spec §13.3): responsiveness, clients, operations health and
 * hygiene. Team and client level only (H4). Every section shows when its data
 * is from and whether its sources are current; missing targets say so.
 */

import { useCallback, useEffect, useState } from "react";
import { BarChart3, CheckCircle2, AlertTriangle, CircleSlash, Download } from "lucide-react";

type Section = "responsiveness" | "clients" | "operations" | "hygiene" | "client_incidents" | "polling";
const TABS: Array<{ key: Section; label: string }> = [
  { key: "responsiveness", label: "Responsiveness" },
  { key: "clients", label: "Clients" },
  { key: "operations", label: "Operations health" },
  { key: "hygiene", label: "Hygiene" },
  { key: "client_incidents", label: "Client incident comms" },
  { key: "polling", label: "Polling health" },
];

/* eslint-disable @typescript-eslint/no-explicit-any -- section payloads are rendered generically; shapes are defined in src/modules/metrics/service.ts */
type Json = any;

interface Freshness { asOf: string; sources: Array<{ source: string; lastSuccessAt: string | null; status: "ok" | "stale" | "never" }> }

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function FreshnessBar({ f }: { f: Freshness }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span>Data as of {new Date(f.asOf).toLocaleString()}</span>
      {f.sources.map((s) => (
        <span key={s.source} className="inline-flex items-center gap-1" title={s.lastSuccessAt ? `Last successful poll ${new Date(s.lastSuccessAt).toLocaleString()}` : "Never polled"}>
          {s.status === "ok" ? <CheckCircle2 size={12} className="text-emerald-500" aria-hidden /> : s.status === "stale" ? <AlertTriangle size={12} className="text-amber-500" aria-hidden /> : <CircleSlash size={12} aria-hidden />}
          {s.source}: {s.status === "ok" ? "current" : s.status === "stale" ? "stale" : "never polled"}
        </span>
      ))}
      {f.sources.length === 0 && <span>No source heartbeats yet.</span>}
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string | number | null; note?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold text-foreground tabular-nums">{value ?? "—"}</p>
      {note && <p className="text-xs text-muted-foreground mt-1">{note}</p>}
    </div>
  );
}

/** Single-series bar chart (one hue, no legend), with a hover tooltip and the values listed below for a table view. */
function Bars({ title, data }: { title: string; data: Array<{ label: string; value: number }> }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure className="bg-card border border-border rounded-xl p-4">
      <figcaption className="text-sm font-medium text-foreground mb-3">{title}</figcaption>
      <div className="flex items-end gap-2 h-32" role="img" aria-label={`${title}: ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`}>
        {data.map((d, i) => (
          <div key={d.label} className="flex-1 flex flex-col items-center justify-end h-full relative" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            {hover === i && <div className="absolute -top-6 text-xs bg-popover text-popover-foreground border border-border rounded px-1.5 py-0.5 whitespace-nowrap">{d.label}: {d.value}</div>}
            <div className="w-full max-w-10 bg-primary rounded-t" style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-1">{data.map((d) => <span key={d.label} className="flex-1 text-center text-[10px] text-muted-foreground">{d.label}</span>)}</div>
      <table className="sr-only"><tbody>{data.map((d) => <tr key={d.label}><th>{d.label}</th><td>{d.value}</td></tr>)}</tbody></table>
    </figure>
  );
}

const pct = (a: Json) => (a?.targetSet ? (a.pct == null ? "no data" : `${a.pct}%`) : "target not set");

function GroupTable({ title, groups }: { title: string; groups: Record<string, Json> }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 overflow-x-auto">
      <h3 className="text-sm font-medium mb-2">{title}</h3>
      <table className="w-full text-xs">
        <thead><tr className="text-left text-muted-foreground"><th>Group</th><th>Items</th><th>Breaches</th><th>Ownership (median / SLA)</th><th>First response</th><th>Resolution</th></tr></thead>
        <tbody>{Object.entries(groups).map(([g, v]) => (
          <tr key={g} className="border-t border-border/50">
            <td className="py-1">{g}</td><td>{v.items}</td><td>{v.breaches}</td>
            {["ownership", "first_response", "resolution"].map((c) => <td key={c}>{v.clocks[c].medianMins ?? "—"} min / {pct(v.clocks[c].attainment)}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Responsiveness({ d }: { d: Json }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Tile label="Work items in period" value={d.overall.items} />
        <Tile label="SLA breaches" value={d.overall.breaches} />
        <Tile label="First-response SLA attainment" value={pct(d.overall.clocks.first_response.attainment)} note={`${d.overall.clocks.first_response.attainment.excludedNonActionable} closed as not a question (excluded)`} />
        <Tile label="Resolution SLA attainment" value={pct(d.overall.clocks.resolution.attainment)} />
      </div>
      <Bars title="Open backlog by age" data={Object.entries(d.backlog.all).map(([label, value]) => ({ label, value: value as number }))} />
      <GroupTable title="By team" groups={d.byTeam} />
      <GroupTable title="By channel" groups={d.byChannel} />
      <GroupTable title="By priority" groups={d.byPriority} />
      <div className="bg-card border border-border rounded-xl p-4 overflow-x-auto">
        <h3 className="text-sm font-medium mb-2">Targets</h3>
        <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th>Policy</th><th>Calendar</th><th>Ownership (min)</th><th>First response (min)</th><th>Resolution</th></tr></thead>
          <tbody>{d.targets.map((t: Json) => <tr key={t.code} className="border-t border-border/50"><td className="py-1">{t.code}</td><td>{t.calendar}</td><td>{t.ownership}</td><td>{t.firstResponse}</td><td>{t.resolution}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}

function Clients({ d }: { d: Json }) {
  const trend = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v}%`);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {[
        { title: `Ranked by ${d.labels.effort}`, rows: d.byEffort, value: (r: Json) => `${r.loggedEffortHours} h`, t: (r: Json) => trend(r.loggedEffortTrendPct) },
        { title: `Ranked by activity (${d.labels.volume})`, rows: d.byVolume, value: (r: Json) => `${r.volume.total} (requests ${r.volume.requestsCreated}, tx ${r.volume.komainuTransactions}, GX requests ${r.volume.komainuRequests}, Slack ${r.volume.slackThreads})`, t: (r: Json) => trend(r.volumeTrendPct) },
      ].map((panel) => (
        <div key={panel.title} className="bg-card border border-border rounded-xl p-4 overflow-x-auto">
          <h3 className="text-sm font-medium mb-2">{panel.title}</h3>
          <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th>Client</th><th>This period</th><th>vs previous</th></tr></thead>
            <tbody>{panel.rows.map((r: Json) => <tr key={r.clientId} className="border-t border-border/50"><td className="py-1">{r.client}</td><td>{panel.value(r)}</td><td>{panel.t(r)}</td></tr>)}</tbody></table>
        </div>
      ))}
    </div>
  );
}

function Operations({ d }: { d: Json }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Tile label="Alerts fired" value={d.alerts.total} />
        <Tile label="Mean time to acknowledge" value={d.alerts.meanMinsToAcknowledge == null ? null : `${d.alerts.meanMinsToAcknowledge} min`} />
        <Tile label="Auto-resolved share" value={d.alerts.autoResolvedShare == null ? null : `${d.alerts.autoResolvedShare}%`} />
        <Tile label="MTD breaks closed within T+1" value={d.mtdBreakClosure.pct == null ? null : `${d.mtdBreakClosure.pct}%`} note={`${d.mtdBreakClosure.withinT1} of ${d.mtdBreakClosure.due} due`} />
      </div>
      <div className="bg-card border border-border rounded-xl p-4 overflow-x-auto">
        <h3 className="text-sm font-medium mb-2">Check completion</h3>
        <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th>Check</th><th>Team</th><th>Items</th><th>On time</th><th>Skipped</th></tr></thead>
          <tbody>{d.checks.map((c: Json) => <tr key={c.code} className="border-t border-border/50"><td className="py-1">{c.code} {c.name}</td><td>{c.team}</td><td>{c.items}</td><td>{c.onTimePct == null ? "—" : `${c.onTimePct}%`}</td><td>{c.skipped}</td></tr>)}</tbody></table>
        {d.checks.length === 0 && <p className="text-xs text-muted-foreground">No check items in this period.</p>}
      </div>
      <div className="bg-card border border-border rounded-xl p-4 overflow-x-auto">
        <h3 className="text-sm font-medium mb-2">OES settlement windows</h3>
        <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th>Exchange</th><th>On time</th><th>Failed</th><th>Stuck</th><th>Not run</th><th>In progress</th></tr></thead>
          <tbody>{Object.entries(d.oesWindows).map(([ex, c]: [string, Json]) => <tr key={ex} className="border-t border-border/50"><td className="py-1">{ex}</td><td>{c.on_time}</td><td>{c.failed}</td><td>{c.stuck}</td><td>{c.not_run}</td><td>{c.in_progress}</td></tr>)}</tbody></table>
      </div>
      <div className="bg-card border border-border rounded-xl p-4 overflow-x-auto">
        <h3 className="text-sm font-medium mb-2">Alerts by rule</h3>
        <table className="w-full text-xs"><tbody>{Object.entries(d.alerts.byRule).map(([rule, n]) => <tr key={rule} className="border-t border-border/50"><td className="py-1">{rule}</td><td>{n as number}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}

function Hygiene({ d }: { d: Json }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Time-logging coverage" value={d.loggingCoverage.pct == null ? null : `${d.loggingCoverage.pct}%`} note={`${d.loggingCoverage.covered} of ${d.loggingCoverage.total} closed client requests; ${d.loggingCoverage.closedNonActionable} not a question`} />
        <Tile label="Unticketed work (latest day)" value={d.unticketedWork.daily.at(-1)?.total ?? null} note="Target 0" />
        <Tile label="Skipped checks" value={d.skippedChecks.total} />
      </div>
      {d.unticketedWork.daily.length > 0 && <Bars title="Unticketed work per day (target 0)" data={d.unticketedWork.daily.map((x: Json) => ({ label: x.date.slice(5), value: x.total }))} />}
    </div>
  );
}

const mins = (v: number | null) => (v == null ? "—" : v < 120 ? `${v} min` : `${Math.round(v / 6) / 10} h`);
const pctOf = (v: number | null) => (v == null ? "—" : `${v}%`);

function ClientIncidentComms({ d }: { d: Json }) {
  const o = d.overall;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Tile label="Raised (client-visible)" value={o.raised} note={`${o.clientRequests} with a client request`} />
        <Tile label="Raise → first public update" value={mins(o.medianMins.raiseToFirstPublicUpdate)} note="median" />
        <Tile label="Update cadence met" value={pct(o.cadence)} note={`${o.cadence.met} met, ${o.cadence.missed} missed, ${o.cadence.pending} open`} />
        <Tile label="Withheld for Compliance" value={d.withheldForCompliance} note="Count only" />
      </div>
      <div className="rounded-xl border border-border bg-card p-4 overflow-x-auto">
        <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th>Client · severity</th><th>Raised</th><th>Raise → client request</th><th>Raise → first update</th><th>Raise → resolved</th><th>Cadence met</th></tr></thead>
          <tbody>{Object.entries(d.byClientAndSeverity).map(([g, v]: [string, Json]) => (
            <tr key={g} className="border-t border-border/50"><td className="py-1">{g}</td><td>{v.raised}</td><td>{mins(v.medianMins.raiseToClientRequest)}</td><td>{mins(v.medianMins.raiseToFirstPublicUpdate)}</td><td>{mins(v.medianMins.raiseToResolved)}</td><td>{pct(v.cadence)}</td></tr>
          ))}</tbody></table>
        {Object.keys(d.byClientAndSeverity).length === 0 && <p className="text-xs text-muted-foreground">No client incidents or risks raised in this period.</p>}
      </div>
    </div>
  );
}

function Polling({ d }: { d: Json }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 overflow-x-auto">
        <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th>Source</th><th>5-minute cycles on time</th><th>On time</th><th>Failed</th><th>Slots</th><th>Measured from</th></tr></thead>
          <tbody>{Object.entries(d.bySource).map(([s, v]: [string, Json]) => (
            <tr key={s} className="border-t border-border/50"><td className="py-1">{s}</td><td>{v.measuredFrom ? pctOf(v.pct) : "never polled"}</td><td>{v.onTime}</td><td>{v.failed}</td><td>{v.slots}</td><td>{v.measuredFrom ? new Date(v.measuredFrom).toLocaleString() : "—"}</td></tr>
          ))}</tbody></table>
      </div>
      <p className="text-xs text-muted-foreground">{d.note}{d.partial ? " This period is partly outside the retention window." : ""}</p>
    </div>
  );
}

export default function MetricsPage() {
  const [tab, setTab] = useState<Section>("responsiveness");
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<Json>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(null);
    setError(null);
    const json = await fetch(`/api/metrics/${tab}?month=${month}`).then((r) => r.json()).catch(() => null);
    if (json?.success) setData(json.data);
    else setError(json?.error ?? "Could not load metrics.");
  }, [tab, month]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2"><BarChart3 size={24} className="text-primary" /> Metrics</h1>
          <p className="text-xs text-muted-foreground mt-1">Team and client level only. Clocks start at source time.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Month <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="ml-1 h-8 rounded-md border border-border bg-background px-2 text-sm" /></label>
          <a href={`/api/metrics/export?month=${month}&format=csv`} className="px-2 py-1.5 text-xs border border-border rounded-md inline-flex items-center gap-1"><Download size={12} /> CSV</a>
          <a href={`/api/metrics/export?month=${month}&format=pdf`} className="px-2 py-1.5 text-xs border border-border rounded-md inline-flex items-center gap-1"><Download size={12} /> Report</a>
        </div>
      </div>
      <div role="tablist" className="flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-sm rounded-lg border ${tab === t.key ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:bg-accent/50"}`}>{t.label}</button>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {!data && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {data && (
        <>
          <FreshnessBar f={data.freshness} />
          {tab === "responsiveness" && <Responsiveness d={data} />}
          {tab === "clients" && <Clients d={data} />}
          {tab === "operations" && <Operations d={data} />}
          {tab === "hygiene" && <Hygiene d={data} />}
          {tab === "client_incidents" && <ClientIncidentComms d={data} />}
          {tab === "polling" && <Polling d={data} />}
        </>
      )}
    </div>
  );
}
