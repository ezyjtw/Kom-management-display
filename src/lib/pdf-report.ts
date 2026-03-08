/**
 * PDF report generation for operations digests.
 *
 * Generates HTML-based reports that can be converted to PDF
 * or served as downloadable HTML documents.
 *
 * Report types:
 * - daily_digest: Morning ops summary
 * - weekly_report: Weekly performance + metrics
 * - incident_report: Single incident detailed report
 * - compliance_summary: Travel rule + screening status
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export type ReportType = "daily_digest" | "weekly_report" | "incident_report" | "compliance_summary";

export interface ReportData {
  type: ReportType;
  title: string;
  generatedAt: string;
  generatedBy: string;
  html: string;
}

/**
 * Generate a report and return HTML content.
 */
export async function generateReport(
  type: ReportType,
  opts: { userId?: string; incidentId?: string; dateRange?: { start: Date; end: Date } } = {},
): Promise<ReportData> {
  const generatedAt = new Date().toISOString();
  const generatedBy = opts.userId || "system";

  let html: string;
  let title: string;

  switch (type) {
    case "daily_digest":
      ({ html, title } = await generateDailyDigest());
      break;
    case "weekly_report":
      ({ html, title } = await generateWeeklyReport(opts.dateRange));
      break;
    case "incident_report":
      ({ html, title } = await generateIncidentReport(opts.incidentId || ""));
      break;
    case "compliance_summary":
      ({ html, title } = await generateComplianceSummary());
      break;
    default:
      throw new Error(`Unknown report type: ${type}`);
  }

  const fullHtml = wrapInTemplate(title, generatedAt, generatedBy, html);

  logger.info("Report generated", { type, title, generatedBy });

  return { type, title, generatedAt, generatedBy, html: fullHtml };
}

// ─── Report generators ───

async function generateDailyDigest(): Promise<{ html: string; title: string }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [
    activeIncidents,
    openThreads,
    slaBreach,
    pendingCases,
    activeAlerts,
    recentConfirmations,
  ] = await Promise.all([
    prisma.incident.count({ where: { status: "active" } }),
    prisma.commsThread.count({ where: { status: { notIn: ["Done", "Closed"] } } }),
    prisma.commsThread.count({
      where: {
        OR: [
          { ttoDeadline: { lt: new Date() }, status: "Unassigned" },
          { ttfaDeadline: { lt: new Date() }, status: { in: ["Assigned", "InProgress"] } },
        ],
      },
    }),
    prisma.travelRuleCase.count({ where: { status: { in: ["Open", "Investigating"] } } }),
    prisma.alert.count({ where: { status: "active" } }),
    prisma.transactionConfirmation.count({
      where: { createdAt: { gte: today }, status: "pending" },
    }),
  ]);

  const title = `Daily Operations Digest — ${today.toISOString().split("T")[0]}`;
  const html = `
    <h2>Operations Summary</h2>
    <table class="stats-table">
      <tr><td class="label">Active Incidents</td><td class="value ${activeIncidents > 0 ? 'warn' : ''}">${activeIncidents}</td></tr>
      <tr><td class="label">Open Comms Threads</td><td class="value">${openThreads}</td></tr>
      <tr><td class="label">SLA Breaches</td><td class="value ${slaBreach > 0 ? 'critical' : ''}">${slaBreach}</td></tr>
      <tr><td class="label">Pending Travel Rule Cases</td><td class="value">${pendingCases}</td></tr>
      <tr><td class="label">Active Alerts</td><td class="value ${activeAlerts > 0 ? 'warn' : ''}">${activeAlerts}</td></tr>
      <tr><td class="label">Pending Confirmations</td><td class="value">${recentConfirmations}</td></tr>
    </table>

    <h2>Active Incidents</h2>
    ${await renderActiveIncidents()}

    <h2>SLA Breaches</h2>
    ${await renderSLABreaches()}
  `;

  return { html, title };
}

async function generateWeeklyReport(dateRange?: { start: Date; end: Date }): Promise<{ html: string; title: string }> {
  const end = dateRange?.end ?? new Date();
  const start = dateRange?.start ?? new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    threadsCreated,
    threadsClosed,
    incidentsCreated,
    incidentsResolved,
    casesCreated,
    casesResolved,
    confirmationsProcessed,
  ] = await Promise.all([
    prisma.commsThread.count({ where: { createdAt: { gte: start, lte: end } } }),
    prisma.commsThread.count({ where: { status: "Closed", lastMessageAt: { gte: start, lte: end } } }),
    prisma.incident.count({ where: { createdAt: { gte: start, lte: end } } }),
    prisma.incident.count({ where: { resolvedAt: { gte: start, lte: end } } }),
    prisma.travelRuleCase.count({ where: { createdAt: { gte: start, lte: end } } }),
    prisma.travelRuleCase.count({ where: { resolvedAt: { gte: start, lte: end } } }),
    prisma.transactionConfirmation.count({
      where: { createdAt: { gte: start, lte: end }, status: { not: "pending" } },
    }),
  ]);

  const title = `Weekly Report — ${start.toISOString().split("T")[0]} to ${end.toISOString().split("T")[0]}`;
  const html = `
    <h2>Weekly Metrics</h2>
    <table class="stats-table">
      <tr><th>Metric</th><th>Created</th><th>Resolved/Closed</th></tr>
      <tr><td>Comms Threads</td><td>${threadsCreated}</td><td>${threadsClosed}</td></tr>
      <tr><td>Incidents</td><td>${incidentsCreated}</td><td>${incidentsResolved}</td></tr>
      <tr><td>Travel Rule Cases</td><td>${casesCreated}</td><td>${casesResolved}</td></tr>
      <tr><td>Transaction Confirmations</td><td colspan="2">${confirmationsProcessed} processed</td></tr>
    </table>
  `;

  return { html, title };
}

async function generateIncidentReport(incidentId: string): Promise<{ html: string; title: string }> {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      updates: { orderBy: { createdAt: "asc" } },
      reportedBy: { select: { name: true } },
      resolvedBy: { select: { name: true } },
    },
  });

  if (!incident) {
    return { html: "<p>Incident not found.</p>", title: "Incident Report — Not Found" };
  }

  const title = `Incident Report — ${incident.title}`;
  const html = `
    <h2>Incident Details</h2>
    <table class="stats-table">
      <tr><td class="label">Title</td><td>${incident.title}</td></tr>
      <tr><td class="label">Provider</td><td>${incident.provider}</td></tr>
      <tr><td class="label">Severity</td><td class="${incident.severity}">${incident.severity.toUpperCase()}</td></tr>
      <tr><td class="label">Status</td><td>${incident.status}</td></tr>
      <tr><td class="label">Started</td><td>${incident.startedAt.toISOString()}</td></tr>
      <tr><td class="label">Resolved</td><td>${incident.resolvedAt?.toISOString() || "Ongoing"}</td></tr>
      <tr><td class="label">Reported By</td><td>${incident.reportedBy.name}</td></tr>
      <tr><td class="label">Resolved By</td><td>${incident.resolvedBy?.name || "—"}</td></tr>
      <tr><td class="label">RCA Status</td><td>${incident.rcaStatus}</td></tr>
    </table>

    <h3>Description</h3>
    <p>${incident.description || "No description provided."}</p>

    <h3>Impact</h3>
    <p>${incident.impact || "No impact assessment."}</p>

    <h3>Timeline</h3>
    <table class="timeline-table">
      <tr><th>Time</th><th>Type</th><th>Details</th></tr>
      ${incident.updates.map((u) => `
        <tr>
          <td>${u.createdAt.toISOString()}</td>
          <td>${u.type}</td>
          <td>${u.content}</td>
        </tr>
      `).join("")}
    </table>
  `;

  return { html, title };
}

async function generateComplianceSummary(): Promise<{ html: string; title: string }> {
  const [
    openCases,
    breachedCases,
    screeningPending,
    screeningCompleted,
    unclassified,
  ] = await Promise.all([
    prisma.travelRuleCase.count({ where: { status: { in: ["Open", "Investigating"] } } }),
    prisma.travelRuleCase.count({ where: { status: { in: ["Open", "Investigating"] }, slaDeadline: { lt: new Date() } } }),
    prisma.screeningEntry.count({ where: { screeningStatus: { in: ["not_submitted", "submitted", "processing"] } } }),
    prisma.screeningEntry.count({ where: { screeningStatus: "completed" } }),
    prisma.screeningEntry.count({ where: { classification: "unclassified" } }),
  ]);

  const title = `Compliance Summary — ${new Date().toISOString().split("T")[0]}`;
  const html = `
    <h2>Travel Rule Compliance</h2>
    <table class="stats-table">
      <tr><td class="label">Open Cases</td><td class="value">${openCases}</td></tr>
      <tr><td class="label">SLA Breached</td><td class="value ${breachedCases > 0 ? 'critical' : ''}">${breachedCases}</td></tr>
    </table>

    <h2>Transaction Screening</h2>
    <table class="stats-table">
      <tr><td class="label">Pending Screening</td><td class="value">${screeningPending}</td></tr>
      <tr><td class="label">Completed</td><td class="value">${screeningCompleted}</td></tr>
      <tr><td class="label">Unclassified</td><td class="value ${unclassified > 0 ? 'warn' : ''}">${unclassified}</td></tr>
    </table>
  `;

  return { html, title };
}

// ─── Helpers ───

async function renderActiveIncidents(): Promise<string> {
  const incidents = await prisma.incident.findMany({
    where: { status: "active" },
    orderBy: { severity: "desc" },
    take: 10,
    select: { title: true, provider: true, severity: true, startedAt: true },
  });

  if (incidents.length === 0) return "<p>No active incidents.</p>";

  return `
    <table class="data-table">
      <tr><th>Title</th><th>Provider</th><th>Severity</th><th>Started</th></tr>
      ${incidents.map((i) => `
        <tr>
          <td>${i.title}</td>
          <td>${i.provider}</td>
          <td class="${i.severity}">${i.severity}</td>
          <td>${i.startedAt.toISOString().split("T")[0]}</td>
        </tr>
      `).join("")}
    </table>
  `;
}

async function renderSLABreaches(): Promise<string> {
  const breached = await prisma.commsThread.findMany({
    where: {
      OR: [
        { ttoDeadline: { lt: new Date() }, status: "Unassigned" },
        { ttfaDeadline: { lt: new Date() }, status: { in: ["Assigned", "InProgress"] } },
      ],
    },
    take: 10,
    select: { id: true, subject: true, priority: true, status: true, ttoDeadline: true },
  });

  if (breached.length === 0) return "<p>No SLA breaches.</p>";

  return `
    <table class="data-table">
      <tr><th>Subject</th><th>Priority</th><th>Status</th><th>Deadline</th></tr>
      ${breached.map((t) => `
        <tr>
          <td>${t.subject}</td>
          <td>${t.priority}</td>
          <td>${t.status}</td>
          <td class="critical">${t.ttoDeadline?.toISOString() || "—"}</td>
        </tr>
      `).join("")}
    </table>
  `;
}

function wrapInTemplate(title: string, generatedAt: string, generatedBy: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 40px; color: #1e293b; }
    h1 { color: #0f172a; border-bottom: 2px solid #2563eb; padding-bottom: 8px; }
    h2 { color: #334155; margin-top: 32px; }
    h3 { color: #475569; }
    .meta { color: #64748b; font-size: 13px; margin-bottom: 24px; }
    .stats-table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    .stats-table td, .stats-table th { padding: 10px 16px; border: 1px solid #e2e8f0; text-align: left; }
    .stats-table th { background: #f1f5f9; font-weight: 600; }
    .label { font-weight: 600; width: 200px; background: #f8fafc; }
    .value { font-size: 18px; font-weight: 700; }
    .data-table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    .data-table td, .data-table th { padding: 8px 12px; border: 1px solid #e2e8f0; text-align: left; }
    .data-table th { background: #f1f5f9; font-weight: 600; }
    .timeline-table { border-collapse: collapse; width: 100%; }
    .timeline-table td, .timeline-table th { padding: 8px 12px; border: 1px solid #e2e8f0; vertical-align: top; }
    .timeline-table th { background: #f1f5f9; }
    .critical { color: #dc2626; font-weight: 700; }
    .warn { color: #f97316; font-weight: 600; }
    .high { color: #dc2626; }
    .medium { color: #f97316; }
    .low { color: #16a34a; }
    @media print {
      body { margin: 20px; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="meta">Generated: ${generatedAt} · By: ${generatedBy}</div>
  ${body}
  <hr style="margin-top:40px;border:none;border-top:1px solid #e2e8f0;" />
  <p class="meta">KOMmand Centre — Confidential</p>
</body>
</html>`;
}
