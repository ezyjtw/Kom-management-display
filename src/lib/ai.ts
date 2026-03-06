/**
 * AI assist client for the ops dashboard — multi-provider.
 *
 * Supports three LLM backends, configured via environment variables:
 *
 *   AI_PROVIDER=groq       → Groq free tier (default if GROQ_API_KEY set)
 *   AI_PROVIDER=anthropic  → Anthropic Claude API (needs ANTHROPIC_API_KEY)
 *   AI_PROVIDER=ollama     → Local Ollama instance (no key needed)
 *
 * The LLM never writes to the database directly — it returns suggestions
 * that the UI presents for human approval before any action is taken.
 */

import Anthropic from "@anthropic-ai/sdk";

// ─── Provider types ─────────────────────────────────────────────────────────

type Provider = "anthropic" | "groq" | "ollama";

interface CompletionRequest {
  system: string;
  userMessage: string;
  maxTokens: number;
}

// ─── Provider detection ─────────────────────────────────────────────────────

function getProvider(): Provider | null {
  const explicit = process.env.AI_PROVIDER?.toLowerCase();
  if (explicit === "anthropic" || explicit === "groq" || explicit === "ollama") return explicit;

  // Auto-detect from available keys
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OLLAMA_BASE_URL) return "ollama";
  return null;
}

export function isAiEnabled(): boolean {
  return getProvider() !== null;
}

export function getProviderName(): string {
  return getProvider() || "none";
}

// ─── Anthropic backend ──────────────────────────────────────────────────────

let anthropicClient: Anthropic | null = null;

async function callAnthropic(req: CompletionRequest): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  const response = await anthropicClient.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [{ role: "user", content: req.userMessage }],
  });

  const block = response.content[0];
  return block.type === "text" ? block.text : null;
}

// ─── Groq backend (OpenAI-compatible API, free tier) ────────────────────────

async function callGroq(req: CompletionRequest): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens,
      temperature: 0.3,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.userMessage },
      ],
    }),
  });

  if (!response.ok) {
    console.error("Groq API error:", response.status, await response.text());
    return null;
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || null;
}

// ─── Ollama backend (local, no API key needed) ─────────────────────────────

async function callOllama(req: CompletionRequest): Promise<string | null> {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "llama3.1";

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.userMessage },
      ],
    }),
  });

  if (!response.ok) {
    console.error("Ollama error:", response.status, await response.text());
    return null;
  }

  const data = await response.json();
  return data.message?.content || null;
}

// ─── Unified completion call ────────────────────────────────────────────────

async function complete(req: CompletionRequest): Promise<string | null> {
  const provider = getProvider();
  if (!provider) return null;

  switch (provider) {
    case "anthropic":
      return callAnthropic(req);
    case "groq":
      return callGroq(req);
    case "ollama":
      return callOllama(req);
  }
}

// ─── Public AI functions ────────────────────────────────────────────────────

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
  return complete({
    system: `You are an operations briefing assistant for a digital asset custody firm (Komainu).
Generate a concise morning briefing for the ops team. Use short bullet points grouped by priority.
Start with any critical items (incidents, SLA breaches), then status overview, then action items.
Use plain text with markdown formatting. Be direct and specific — no filler.
If there are active incidents, lead with those. If everything is clear, say so briefly.`,
    userMessage: `Generate the morning ops briefing from this data:\n\n${JSON.stringify(data, null, 2)}`,
    maxTokens: 1024,
  });
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
  const text = await complete({
    system: `You are a triage assistant for a digital asset custody ops team.
Given a thread subject, source, client tag, and latest message, suggest a priority level.

Priority levels:
- P0: System outage, security breach, data loss, production down
- P1: Urgent client issue, regulatory deadline, blocked operations, escalation
- P2: Important but not time-critical, standard client requests, process issues
- P3: Routine queries, informational, low-impact administrative

Respond with ONLY valid JSON: {"priority":"P0","reason":"one sentence explanation"}`,
    userMessage: JSON.stringify(thread),
    maxTokens: 256,
  });

  if (!text) return null;
  try {
    // Extract JSON from response (some models wrap it in markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
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
  return complete({
    system: `You are an ops incident assistant for a digital asset custody firm.
Given an incident title, provider, severity, and description, draft a concise operational impact statement.
Focus on: what operations are affected, what clients might notice, and what workarounds exist.
Keep it to 2-3 sentences. Be specific to digital asset custody operations (transactions, signing, staking, settlements).`,
    userMessage: JSON.stringify(incident),
    maxTokens: 512,
  });
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
  return complete({
    system: `You are an ops analyst for a digital asset custody firm.
Analyse this client's recent activity pattern and provide a 1-2 sentence insight.
Focus on: repeated issues, escalation patterns, potential relationship risks, or positive signals.
If nothing notable, respond with just "No notable patterns."`,
    userMessage: JSON.stringify(client),
    maxTokens: 256,
  });
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
  return complete({
    system: `You are a compliance assistant for a digital asset custody firm (Komainu).
Draft a professional email to a counterparty VASP requesting missing travel rule information.
The email should be formal, reference the specific transaction, and clearly state what information is needed.
Follow FATF Travel Rule requirements (originator/beneficiary name, address, account).
Return ONLY the email body text (no subject line, no headers).`,
    userMessage: JSON.stringify(caseData),
    maxTokens: 512,
  });
}
