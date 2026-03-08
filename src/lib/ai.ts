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

/**
 * Research a token for custody onboarding review.
 * Analyses the token from multiple angles and returns a structured assessment
 * that an operator can review, then approve or reject.
 *
 * Returns JSON: { summary, riskAssessment, regulatoryConsiderations,
 *   custodyFeasibility, institutionalDemand, stakingInfo, recommendation }
 */
export async function researchToken(token: {
  symbol: string;
  name: string;
  network: string;
  tokenType: string;
  contractAddress?: string;
  marketCapTier?: string;
  existingNotes?: string;
  demandSignals?: Array<{ signalType: string; source: string; description: string }>;
}): Promise<Record<string, unknown> | null> {
  const text = await complete({
    system: `You are a digital asset research analyst for Komainu, an institutional-grade custody firm.
Your job is to perform due diligence on tokens being considered for custody onboarding.

Analyse the token and provide a structured assessment covering:

1. **summary**: 2-3 sentence overview of what this token/project does, its position in the market, and relevance to institutional investors.

2. **riskAssessment**: Key risks — smart contract risk (if applicable), centralization concerns, liquidity risk, team/governance risks. Rate overall as "low", "medium", "high", or "critical".

3. **regulatoryConsiderations**: An object with per-jurisdiction analysis. Structure it as:
   {
     "overall": "Brief overall regulatory risk summary",
     "jurisdictions": {
       "US": "SEC/CFTC classification risk, Howey test analysis, any enforcement actions",
       "EU": "MiCA classification (e-money token, asset-referenced token, crypto-asset), compliance status",
       "UK": "FCA classification, financial promotion rules, whether it's a specified investment",
       "Switzerland": "FINMA token classification (payment, utility, asset), Swiss DLT framework status",
       "Singapore": "MAS classification under Payment Services Act, Digital Payment Token status",
       "Japan": "JFSA classification, whether listed on registered exchanges, JVCEA status",
       "UAE": "VARA/ADGM classification and licensing requirements",
       "Hong_Kong": "SFC classification, whether it's a virtual asset under the new regime"
     },
     "sanctionsExposure": "Any sanctions-related concerns (OFAC, EU sanctions lists)",
     "keyRisks": ["risk1", "risk2"]
   }

4. **custodyFeasibility**: Technical considerations for custody — key management complexity, multi-sig support, hardware wallet compatibility (Ledger, Fireblocks), transaction signing requirements, any chain-specific quirks.

5. **institutionalDemand**: Assessment of institutional interest — ETF/ETP products tracking this asset, institutional fund allocations, OTC market depth, competitor custodian support.

6. **stakingInfo**: If staking is available — validator ecosystem maturity, expected yields, lock-up periods, slashing risks, delegation mechanics. If not applicable, state "Not applicable".

7. **chainAnalysis**: Chain/network-level considerations — network maturity and uptime history, finality time, transaction throughput, gas/fee model, reorg risk, bridge dependencies (if L2 or cross-chain), node infrastructure availability, chain-specific operational risks (e.g. account model quirks, memo requirements, minimum balances, dust limits), and any known chain incidents or vulnerabilities.

8. **securityHistory**: An object covering the token/project/chain's history of hacks, exploits, and security incidents. Structure it as:
   {
     "incidents": [
       {
         "date": "YYYY-MM or approximate",
         "type": "hack|exploit|rug_pull|bridge_exploit|flash_loan|governance_attack|smart_contract_bug|51%_attack|other",
         "description": "Brief description of the incident",
         "fundsLost": "Estimated USD value lost, or 'N/A'",
         "recovered": "Whether funds were recovered, partially recovered, or not",
         "rootCause": "Brief root cause explanation"
       }
     ],
     "auditHistory": "Summary of smart contract audits — who audited, when, findings severity",
     "bugBountyProgram": "Whether a bug bounty program exists, platform (Immunefi, HackerOne, etc.), max payout",
     "overallSecurityRating": "strong|adequate|concerning|poor — based on incident history, audit coverage, and security posture",
     "operationalRisks": "Any ongoing security concerns relevant to custody operations (e.g. bridge dependencies, admin key risks, upgrade mechanisms)"
   }
   If no known incidents exist, return an empty incidents array but still assess audit history and security posture.

9. **recommendation**: Your overall recommendation — "approve" (low risk, strong demand), "approve_with_conditions" (manageable risks, worth supporting with safeguards), "further_review" (significant unknowns, needs deeper investigation), or "reject" (unacceptable risk or regulatory exposure). Include a 1-2 sentence rationale.

Respond with ONLY valid JSON matching this structure. Be specific to institutional custody operations. Base your analysis on the token's known characteristics as of your knowledge cutoff.`,
    userMessage: `Research this token for custody onboarding:\n\n${JSON.stringify(token, null, 2)}`,
    maxTokens: 3072,
  });

  if (!text) return null;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch {
    // If JSON parsing fails, return the raw text in a structured wrapper
    return { summary: text, riskAssessment: null, recommendation: "further_review" };
  }
}

/**
 * Suggest popular tokens/chain combos that institutions want but aren't
 * yet in the custody registry. Takes the current list of supported tokens
 * and proposes gaps worth filling.
 *
 * Returns JSON array of suggested tokens with rationale.
 */
/**
 * Summarise daily check results into a Jira-ready report.
 */
export async function summariseDailyChecks(data: {
  date: string;
  items: Array<{
    name: string;
    category: string;
    status: string;
    autoResult: string;
    notes: string;
  }>;
}): Promise<string | null> {
  return complete({
    system: `You are an ops report writer for a digital asset custody firm (Komainu).
Given daily check results, produce a concise Jira ticket summary grouped by category.
Lead with issues found, then confirmations. Use bullet points.
Format: "## Daily Ops Check — [date]" then categories as ### headings.
Mark issues with ⚠️ and passes with ✅. Keep it brief and actionable.`,
    userMessage: `Generate a Jira summary for these daily check results:\n\n${JSON.stringify(data, null, 2)}`,
    maxTokens: 1024,
  });
}

/**
 * Explain why a staking wallet's reward is late or has a balance variance.
 */
export async function analyseStakingAnomaly(wallet: {
  asset: string;
  network: string;
  validatorName: string;
  rewardModel: string;
  expectedRewardFrequencyHours: number;
  lastRewardAt: string | null;
  nextExpectedRewardAt: string | null;
  stakedAmount: number;
  onChainBalance: number;
  platformBalance: number;
  varianceAmount: number;
  isColdStaking: boolean;
  isTestWallet: boolean;
  minimumThreshold: number;
  rewardStatus: string;
}): Promise<string | null> {
  return complete({
    system: `You are a staking operations analyst for a digital asset custody firm.
Explain why this staking wallet's reward may be late or its balance shows a variance.
Consider: reward model timing, minimum thresholds, validator behavior, chain-specific delays, test wallets, cold staking specifics.
Provide a 1-2 sentence explanation that an operator can use to decide if action is needed.`,
    userMessage: JSON.stringify(wallet),
    maxTokens: 256,
  });
}

/**
 * AI-assisted risk classification for a screening entry.
 * Returns JSON with riskLevel, reasoning, and suggestedAction.
 */
export async function classifyScreeningRisk(entry: {
  transactionId: string;
  txHash: string;
  asset: string;
  amount: number;
  direction: string;
  screeningStatus: string;
  riskScore: number;
  classification: string;
}): Promise<{ riskLevel: string; reasoning: string; suggestedAction: string } | null> {
  const text = await complete({
    system: `You are a transaction screening analyst for a digital asset custody firm.
Given transaction details and screening data, classify the risk level and suggest an action.
Consider: amount thresholds, asset risk profile, screening status, direction, and existing classification.
Respond with ONLY valid JSON: {"riskLevel":"low|medium|high|critical","reasoning":"brief explanation","suggestedAction":"clear|review|escalate|block"}`,
    userMessage: JSON.stringify(entry),
    maxTokens: 256,
  });

  if (!text) return null;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Draft an RCA summary from incident details and timeline.
 */
export async function draftRcaSummary(incident: {
  title: string;
  provider: string;
  severity: string;
  description: string;
  status: string;
  rcaStatus: string;
  updates: Array<{ message: string; createdAt: string; authorName: string }>;
  followUpItems: string[];
}): Promise<string | null> {
  return complete({
    system: `You are an incident management analyst for a digital asset custody firm.
Draft a concise RCA summary covering:
1. **Incident Overview** — what happened, when, and which systems/clients were affected
2. **Root Cause** — the underlying technical or process failure
3. **Impact Assessment** — operational and client impact
4. **Remediation Actions** — what was done to resolve the incident
5. **Preventive Measures** — what changes will prevent recurrence

Use markdown formatting. Be specific to digital asset custody operations. Keep it to one page.`,
    userMessage: JSON.stringify(incident),
    maxTokens: 1024,
  });
}

/**
 * Draft a compliance escalation note for an approval request.
 */
export async function draftEscalationNote(request: {
  requestId: string;
  type: string;
  entity: string;
  requestedAt: string;
  expiresAt: string;
  ageMinutes: number;
  riskLevel: string;
  lane: string;
}): Promise<string | null> {
  return complete({
    system: `You are a compliance liaison for a digital asset custody firm (Komainu).
Draft a concise escalation note for a compliance reviewer, including:
- Request summary (type, entity, age)
- Risk factors identified
- Recommended urgency level
- Specific questions for compliance to address

Keep it professional and under 200 words. Use bullet points.`,
    userMessage: JSON.stringify(request),
    maxTokens: 512,
  });
}

/**
 * Analyse stuck/slow transactions and identify patterns.
 */
export async function analyseStuckTransactions(transactions: Array<{
  id: string;
  asset: string;
  network?: string;
  ageMinutes: number;
  status: string;
  amount?: number;
}>): Promise<string | null> {
  return complete({
    system: `You are a blockchain operations analyst for a digital asset custody firm.
Analyse these stuck/slow transactions and identify patterns:
- Chain congestion issues
- Fee-related delays
- Validator or node delays
- Systemic problems across chains or assets
- Any common factors

Provide a brief operational summary (3-5 bullet points) that an operator can use in a daily check report.`,
    userMessage: `Stuck/slow transactions:\n\n${JSON.stringify(transactions, null, 2)}`,
    maxTokens: 512,
  });
}

export async function suggestTokensToOnboard(context: {
  existingTokens: Array<{ symbol: string; network: string; status: string }>;
  clientDemandSignals?: Array<{ source: string; description: string }>;
}): Promise<Array<Record<string, unknown>> | null> {
  const text = await complete({
    system: `You are a digital asset strategy analyst for Komainu, an institutional-grade custody firm.
Your job is to identify tokens and chain combinations that institutional clients are likely to demand but are NOT yet supported.

Given the list of tokens already in the registry, suggest 5-8 popular token/chain combinations worth evaluating. Focus on:

1. **Institutional demand**: Tokens with existing ETFs/ETPs, significant institutional fund allocations, or growing OTC markets
2. **Chain diversity**: Major L1s, important L2s, and multi-chain deployments (e.g. USDT on Tron, stablecoins on multiple chains)
3. **Competitor gap**: Tokens supported by competing custodians (BitGo, Anchorage, Coinbase Custody, Copper) but not yet listed
4. **Emerging institutional assets**: RWA tokens, liquid staking derivatives, and tokenized assets gaining traction
5. **Staking opportunities**: Tokens where custody clients would benefit from staking yield

For each suggestion, provide:
- **symbol**: Token ticker
- **name**: Full name
- **network**: Primary chain/network
- **tokenType**: native, erc20, spl, substrate, other
- **marketCapTier**: mega, large, mid, small
- **rationale**: 1-2 sentences on why institutions want this
- **urgency**: "high" (clients actively asking), "medium" (growing demand), "low" (proactive positioning)
- **suggestedRiskLevel**: Initial risk assessment — low, medium, high
- **chains**: Array of chains this token operates on (for multi-chain tokens)

Do NOT suggest tokens that already appear in the existing registry.
Respond with ONLY a valid JSON array.`,
    userMessage: `Current token registry:\n${JSON.stringify(context.existingTokens, null, 2)}\n\n${
      context.clientDemandSignals?.length
        ? `Recent client demand signals:\n${JSON.stringify(context.clientDemandSignals, null, 2)}`
        : "No specific client demand signals provided."
    }`,
    maxTokens: 2048,
  });

  if (!text) return null;
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch {
    return null;
  }
}
