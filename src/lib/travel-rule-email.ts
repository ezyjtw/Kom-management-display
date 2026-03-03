/**
 * Travel Rule email sender.
 *
 * Generates a clean HTML table with originator/beneficiary details
 * and sends it via the existing SMTP integration.
 */

export interface TravelRuleCaseData {
  transactionId: string;
  txHash: string;
  direction: string;
  asset: string;
  amount: number;
  senderAddress: string;
  receiverAddress: string;
  matchStatus: string;
  notabeneTransferId: string | null;
}

export interface SendTravelRuleEmailParams {
  recipientEmail: string;
  recipientName: string;
  travelCase: TravelRuleCaseData;
  senderName: string;
}

export function buildHtmlEmail(params: SendTravelRuleEmailParams): string {
  const { travelCase, senderName, recipientName } = params;
  const isInbound = travelCase.direction === "IN";
  const greeting = recipientName
    ? `Dear ${recipientName},`
    : "Dear Compliance Team,";

  const requestType =
    travelCase.matchStatus === "unmatched"
      ? "We have identified a transaction for which we have not received any travel rule information. Please provide the required originator and beneficiary details at your earliest convenience."
      : travelCase.matchStatus === "missing_originator"
        ? "We have received travel rule information for the following transaction, but the <strong>originator details are missing or incomplete</strong>. Please provide the required information."
        : "We have received travel rule information for the following transaction, but the <strong>beneficiary details are missing or incomplete</strong>. Please provide the required information.";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; line-height: 1.6; margin: 0; padding: 20px; }
    .container { max-width: 640px; margin: 0 auto; }
    h2 { color: #111827; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0 24px; }
    th, td { text-align: left; padding: 10px 14px; border: 1px solid #d1d5db; }
    th { background-color: #f3f4f6; font-weight: 600; width: 40%; color: #374151; font-size: 13px; text-transform: uppercase; letter-spacing: 0.03em; }
    td { background-color: #ffffff; font-family: 'SF Mono', 'Consolas', monospace; font-size: 14px; }
    .highlight { background-color: #fef3c7; }
    .urgent { color: #dc2626; font-weight: 600; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Travel Rule Information Request</h2>

    <p>${greeting}</p>
    <p>${requestType}</p>

    <h3>Transaction Details</h3>
    <table>
      <tr>
        <th>Transaction ID</th>
        <td>${escapeHtml(travelCase.transactionId)}</td>
      </tr>
      ${travelCase.txHash ? `<tr><th>Transaction Hash</th><td>${escapeHtml(travelCase.txHash)}</td></tr>` : ""}
      <tr>
        <th>Direction</th>
        <td>${travelCase.direction === "IN" ? "Inbound" : travelCase.direction === "OUT" ? "Outbound" : travelCase.direction}</td>
      </tr>
      <tr>
        <th>Asset</th>
        <td>${escapeHtml(travelCase.asset)}</td>
      </tr>
      <tr>
        <th>Amount</th>
        <td>${travelCase.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
      </tr>
    </table>

    <h3>Originator ${travelCase.matchStatus === "missing_originator" ? '<span class="urgent">(REQUIRED)</span>' : ""}</h3>
    <table>
      <tr class="${travelCase.matchStatus === "missing_originator" || travelCase.matchStatus === "unmatched" ? "highlight" : ""}">
        <th>Originator Address</th>
        <td>${escapeHtml(travelCase.senderAddress) || '<span class="urgent">Required</span>'}</td>
      </tr>
      <tr class="${travelCase.matchStatus === "missing_originator" || travelCase.matchStatus === "unmatched" ? "highlight" : ""}">
        <th>Originator Name</th>
        <td><span class="urgent">Please provide</span></td>
      </tr>
      <tr class="${travelCase.matchStatus === "missing_originator" || travelCase.matchStatus === "unmatched" ? "highlight" : ""}">
        <th>Originator Address (Physical)</th>
        <td><span class="urgent">Please provide</span></td>
      </tr>
    </table>

    <h3>Beneficiary ${travelCase.matchStatus === "missing_beneficiary" ? '<span class="urgent">(REQUIRED)</span>' : ""}</h3>
    <table>
      <tr class="${travelCase.matchStatus === "missing_beneficiary" || travelCase.matchStatus === "unmatched" ? "highlight" : ""}">
        <th>Beneficiary Address</th>
        <td>${escapeHtml(travelCase.receiverAddress) || '<span class="urgent">Required</span>'}</td>
      </tr>
      <tr class="${travelCase.matchStatus === "missing_beneficiary" || travelCase.matchStatus === "unmatched" ? "highlight" : ""}">
        <th>Beneficiary Name</th>
        <td><span class="urgent">Please provide</span></td>
      </tr>
      <tr class="${travelCase.matchStatus === "missing_beneficiary" || travelCase.matchStatus === "unmatched" ? "highlight" : ""}">
        <th>Beneficiary Address (Physical)</th>
        <td><span class="urgent">Please provide</span></td>
      </tr>
    </table>

    <p>Please respond to this email with the requested information. If you have any questions, do not hesitate to contact us.</p>

    <p>Kind regards,<br>${escapeHtml(senderName)}</p>

    <div class="footer">
      This email was sent as part of Travel Rule compliance obligations under the FATF Recommendation 16 / EU Transfer of Funds Regulation.
      ${travelCase.notabeneTransferId ? `<br>Notabene Transfer ID: ${escapeHtml(travelCase.notabeneTransferId)}` : ""}
    </div>
  </div>
</body>
</html>`.trim();
}

function buildPlainTextEmail(params: SendTravelRuleEmailParams): string {
  const { travelCase, senderName, recipientName } = params;
  const greeting = recipientName
    ? `Dear ${recipientName},`
    : "Dear Compliance Team,";

  return [
    "TRAVEL RULE INFORMATION REQUEST",
    "",
    greeting,
    "",
    travelCase.matchStatus === "unmatched"
      ? "We have identified a transaction for which we have not received any travel rule information."
      : travelCase.matchStatus === "missing_originator"
        ? "The originator details are missing or incomplete for the following transaction."
        : "The beneficiary details are missing or incomplete for the following transaction.",
    "",
    "TRANSACTION DETAILS",
    `  Transaction ID: ${travelCase.transactionId}`,
    travelCase.txHash ? `  Transaction Hash: ${travelCase.txHash}` : "",
    `  Direction: ${travelCase.direction}`,
    `  Asset: ${travelCase.asset}`,
    `  Amount: ${travelCase.amount}`,
    "",
    "ORIGINATOR",
    `  Address: ${travelCase.senderAddress || "(Required)"}`,
    "  Name: (Please provide)",
    "  Physical Address: (Please provide)",
    "",
    "BENEFICIARY",
    `  Address: ${travelCase.receiverAddress || "(Required)"}`,
    "  Name: (Please provide)",
    "  Physical Address: (Please provide)",
    "",
    "Please respond with the requested information.",
    "",
    `Kind regards,`,
    senderName,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Send a travel rule information request email.
 */
export async function sendTravelRuleEmail(
  params: SendTravelRuleEmailParams,
): Promise<void> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (!host || !user || !pass) {
    throw new Error(
      "SMTP not configured: SMTP_HOST, SMTP_USER, and SMTP_PASSWORD are required to send travel rule emails",
    );
  }

  const nodemailer = await import("nodemailer");

  const transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
  });

  const subject = `Travel Rule Information Request — ${params.travelCase.asset} ${params.travelCase.direction} ${params.travelCase.transactionId}`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM || user,
    to: params.recipientEmail,
    subject,
    text: buildPlainTextEmail(params),
    html: buildHtmlEmail(params),
  });
}
