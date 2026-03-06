import Anthropic from "@anthropic-ai/sdk";

/**
 * AI assist client for the ops dashboard.
 *
 * Wraps the Anthropic Claude API with ops-specific system prompts.
 * The LLM never writes to the database directly — it returns suggestions
 * that the UI presents for human approval before any action is taken.
 *
 * Set ANTHROPIC_API_KEY in environment to enable AI features.
 * When the key is missing, all functions return graceful fallbacks
 * so the dashboard works without AI.
 */

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export function isAiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

// Model to use — Sonnet for speed/cost balance on operational tasks
const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 1024;

/**
 * Generate a daily ops briefing from Command Centre data.
 * Returns a structured markdown summary suitable for display or Slack.
 */
export async function generateBriefing(data: {
  travelRule: { openCount: number; redCount: number; amberCount: number };
  comms: { totalActive: number; breachedCount: number; unassignedCount: number };
  alerts: { activeCount: number };
  dailyTasks: { total: number; completed: number; pending: number; inProgress: number; urgent: number };
  coverage: { total: number; active: number; onQueues: number; onBreak: number };
  incidents: { activeCount: number; criticalCount: number; items: Array<{ title: string; provider: string; severity: string; status: string }> };
  projects: { activeCount: number; overdueCount: number };
  recentActivity: Array<{ action: string; userName: string; details: string }>;
}): Promise<string | null> {
  const ai = getClient();
  if (!ai) return null;

  const response = await ai.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: `You are an operations briefing assistant for a digital asset custody firm (Komainu).
Generate a concise morning briefing for the ops team. Use short bullet points grouped by priority.
Start with any critical items (incidents, SLA breaches), then status overview, then action items.
Use plain text with markdown formatting. Be direct and specific — no filler.
If there are active incidents, lead with those. If everything is clear, say so briefly.`,
    messages: [{
      role: "user",
      content: `Generate the morning ops briefing from this data:\n\n${JSON.stringify(data, null, 2)}`,
    }],
  });

  const block = response.content[0];
  return block.type === "text" ? block.text : null;
}

/**
 * Suggest a priority and short rationale for an incoming comms thread.
 * Returns { priority: "P0"|"P1"|"P2"|"P3", reason: string } or null.
 */
export async function suggestThreadPriority(thread: {
  subject: string;
  source: string;
  clientOrPartnerTag: string;
  latestMessage?: string;
}): Promise<{ priority: string; reason: string } | null> {
  const ai = getClient();
  if (!ai) return null;

  const response = await ai.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: `You are a triage assistant for a digital asset custody ops team.
Given a thread subject, source, client tag, and latest message, suggest a priority level.

Priority levels:
- P0: System outage, security breach, data loss, production down
- P1: Urgent client issue, regulatory deadline, blocked operations, escalation
- P2: Important but not time-critical, standard client requests, process issues
- P3: Routine queries, informational, low-impact administrative

Respond with ONLY valid JSON: {"priority":"P0","reason":"one sentence explanation"}`,
    messages: [{
      role: "user",
      content: JSON.stringify(thread),
    }],
  });

  const block = response.content[0];
  if (block.type !== "text") return null;

  try {
    return JSON.parse(block.text);
  } catch {
    return null;
  }
}

/**
 * Draft an incident impact description from the incident details.
 * Returns a markdown string the user can edit before saving.
 */
export async function draftIncidentImpact(incident: {
  title: string;
  provider: string;
  severity: string;
  description: string;
}): Promise<string | null> {
  const ai = getClient();
  if (!ai) return null;

  const response = await ai.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: `You are an ops incident assistant for a digital asset custody firm.
Given an incident title, provider, severity, and description, draft a concise operational impact statement.
Focus on: what operations are affected, what clients might notice, and what workarounds exist.
Keep it to 2-3 sentences. Be specific to digital asset custody operations (transactions, signing, staking, settlements).`,
    messages: [{
      role: "user",
      content: JSON.stringify(incident),
    }],
  });

  const block = response.content[0];
  return block.type === "text" ? block.text : null;
}

/**
 * Analyse a client's recent activity and suggest if there's a pattern worth noting.
 * Returns a short insight string or null.
 */
export async function analyseClientPattern(client: {
  name: string;
  threadCount: number;
  openThreads: number;
  slaBreaches: number;
  highPriorityThreads: number;
  recentThreads: Array<{ subject: string; priority: string; status: string; source: string }>;
}): Promise<string | null> {
  const ai = getClient();
  if (!ai) return null;

  const response = await ai.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: `You are an ops analyst for a digital asset custody firm.
Analyse this client's recent activity pattern and provide a 1-2 sentence insight.
Focus on: repeated issues, escalation patterns, potential relationship risks, or positive signals.
If nothing notable, respond with just "No notable patterns."`,
    messages: [{
      role: "user",
      content: JSON.stringify(client),
    }],
  });

  const block = response.content[0];
  return block.type === "text" ? block.text : null;
}

/**
 * Draft a travel rule counterparty email for a missing originator/beneficiary case.
 */
export async function draftTravelRuleEmail(caseData: {
  transactionId: string;
  direction: string;
  asset: string;
  amount: number;
  matchStatus: string;
  counterpartyVasp?: string;
}): Promise<string | null> {
  const ai = getClient();
  if (!ai) return null;

  const response = await ai.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: `You are a compliance assistant for a digital asset custody firm (Komainu).
Draft a professional email to a counterparty VASP requesting missing travel rule information.
The email should be formal, reference the specific transaction, and clearly state what information is needed.
Follow FATF Travel Rule requirements (originator/beneficiary name, address, account).
Return ONLY the email body text (no subject line, no headers).`,
    messages: [{
      role: "user",
      content: JSON.stringify(caseData),
    }],
  });

  const block = response.content[0];
  return block.type === "text" ? block.text : null;
}
