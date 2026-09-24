/**
 * Monthly metrics pack (spec §13.3): CSV rows and the HTML body for the
 * existing PDF report. Team and client level only (H4): values come from the
 * metrics sections, which carry no person fields.
 */

import { clientIncidentComms, clientsSection, hygiene, operationsHealth, pollingHealthSection, responsiveness, type Period } from "@/modules/metrics/service";

export interface MetricRow {
  section: string;
  group: string;
  metric: string;
  value: string | number | null;
}

type Pack = {
  responsiveness: Awaited<ReturnType<typeof responsiveness>>;
  clients: Awaited<ReturnType<typeof clientsSection>>;
  operations: Awaited<ReturnType<typeof operationsHealth>>;
  hygiene: Awaited<ReturnType<typeof hygiene>>;
  clientIncidents: Awaited<ReturnType<typeof clientIncidentComms>>;
  polling: Awaited<ReturnType<typeof pollingHealthSection>>;
};

export async function buildPack(period: Period, now = new Date()): Promise<Pack> {
  const [r, c, o, h, ci, pl] = await Promise.all([
    responsiveness(period, now), clientsSection(period, now), operationsHealth(period, now), hygiene(period, now),
    clientIncidentComms(period, now), pollingHealthSection(period, now),
  ]);
  return { responsiveness: r, clients: c, operations: o, hygiene: h, clientIncidents: ci, polling: pl };
}

export function packRows(p: Pack): MetricRow[] {
  const rows: MetricRow[] = [];
  const push = (section: string, group: string, metric: string, value: MetricRow["value"]) => rows.push({ section, group, metric, value });

  const resp = (groupKind: string, groups: Record<string, Pack["responsiveness"]["overall"]>) => {
    for (const [g, v] of Object.entries(groups)) {
      push("responsiveness", `${groupKind}:${g}`, "items", v.items);
      push("responsiveness", `${groupKind}:${g}`, "breaches", v.breaches);
      for (const [clock, c] of Object.entries(v.clocks)) {
        push("responsiveness", `${groupKind}:${g}`, `${clock}.median_mins`, c.medianMins);
        push("responsiveness", `${groupKind}:${g}`, `${clock}.attainment_pct`, c.attainment.targetSet ? c.attainment.pct : "target not set");
        push("responsiveness", `${groupKind}:${g}`, `${clock}.excluded_non_actionable`, c.attainment.excludedNonActionable);
      }
    }
  };
  resp("all", { all: p.responsiveness.overall });
  resp("team", p.responsiveness.byTeam);
  resp("channel", p.responsiveness.byChannel);
  resp("priority", p.responsiveness.byPriority);
  for (const [band, n] of Object.entries(p.responsiveness.backlog.all)) push("responsiveness", "backlog", band, n);

  for (const c of p.clients.byEffort) {
    push("clients", c.client, "logged_effort_hours", c.loggedEffortHours);
    push("clients", c.client, "logged_effort_trend_pct", c.loggedEffortTrendPct);
    push("clients", c.client, "volume_total (volume, not effort)", c.volume.total);
    push("clients", c.client, "volume_trend_pct", c.volumeTrendPct);
  }

  for (const c of p.operations.checks) {
    push("operations", `check:${c.code}`, "on_time_pct", c.onTimePct);
    push("operations", `check:${c.code}`, "skipped", c.skipped);
  }
  for (const [ex, counts] of Object.entries(p.operations.oesWindows)) for (const [k, n] of Object.entries(counts)) push("operations", `oes:${ex}`, k, n);
  push("operations", "alerts", "total", p.operations.alerts.total);
  push("operations", "alerts", "mean_mins_to_acknowledge", p.operations.alerts.meanMinsToAcknowledge);
  push("operations", "alerts", "auto_resolved_share_pct", p.operations.alerts.autoResolvedShare);
  for (const [rule, n] of Object.entries(p.operations.alerts.byRule)) push("operations", "alerts_by_rule", rule, n);
  push("operations", "mtd", "closed_within_t1_pct", p.operations.mtdBreakClosure.pct);

  push("hygiene", "logging", "coverage_pct", p.hygiene.loggingCoverage.pct);
  push("hygiene", "logging", "closed_non_actionable", p.hygiene.loggingCoverage.closedNonActionable);
  for (const d of p.hygiene.unticketedWork.daily) push("hygiene", "unticketed_work (target 0)", d.date, d.total);
  push("hygiene", "skipped_checks", "total", p.hygiene.skippedChecks.total);

  const ci = (group: string, v: Pack["clientIncidents"]["overall"]) => {
    push("client_incidents", group, "raised", v.raised);
    push("client_incidents", group, "client_requests", v.clientRequests);
    push("client_incidents", group, "raise_to_client_request.median_mins", v.medianMins.raiseToClientRequest);
    push("client_incidents", group, "raise_to_first_public_update.median_mins", v.medianMins.raiseToFirstPublicUpdate);
    push("client_incidents", group, "raise_to_resolved.median_mins", v.medianMins.raiseToResolved);
    push("client_incidents", group, "update_cadence_attainment_pct", v.cadence.targetSet ? v.cadence.pct : "target not set");
  };
  ci("all", p.clientIncidents.overall);
  for (const [g, v] of Object.entries(p.clientIncidents.byClientAndSeverity)) ci(g, v);
  push("client_incidents", "compliance", "withheld_count", p.clientIncidents.withheldForCompliance);

  for (const [source, v] of Object.entries(p.polling.bySource)) {
    push("polling", source, "cycles_on_time_pct", v.measuredFrom ? v.pct : "never polled");
    push("polling", source, "slots", v.slots);
    push("polling", source, "failed", v.failed);
  }
  return rows;
}

const csvCell = (v: MetricRow["value"]) => {
  const s = v == null ? "" : String(v);
  // Neutralise spreadsheet formulas and quote as needed.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(rows: MetricRow[]): string {
  return ["section,group,metric,value", ...rows.map((r) => [r.section, r.group, r.metric, r.value].map(csvCell).join(","))].join("\n");
}

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const TITLES: Record<string, string> = {
  responsiveness: "Responsiveness", clients: "Clients", operations: "Operations", hygiene: "Hygiene",
  client_incidents: "Client incident communication", polling: "Polling health",
};

export function toHtml(month: string, p: Pack, rows: MetricRow[]): { title: string; html: string } {
  const sections = ["responsiveness", "clients", "operations", "hygiene", "client_incidents", "polling"];
  const stale = p.responsiveness.freshness.sources.filter((s) => s.status !== "ok").map((s) => s.source);
  const html = `
    <p class="meta">Team and client level only. Effort is logged effort; volume is volume, not effort. Data as of ${esc(p.responsiveness.freshness.asOf)}${stale.length ? `; sources not current: ${esc(stale.join(", "))}` : ""}.</p>
    ${sections.map((s) => `
      <h2>${esc(TITLES[s] ?? s)}</h2>
      <table class="data-table"><tr><th>Group</th><th>Metric</th><th>Value</th></tr>
      ${rows.filter((r) => r.section === s).map((r) => `<tr><td>${esc(r.group)}</td><td>${esc(r.metric)}</td><td>${esc(r.value ?? "—")}</td></tr>`).join("")}
      </table>`).join("")}
  `;
  return { title: `Monthly metrics — ${month}`, html };
}
