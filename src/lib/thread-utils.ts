import type { ThreadPriority } from "@/types";

// ---------------------------------------------------------------------------
// Title normalisation
// ---------------------------------------------------------------------------

/**
 * Clean and normalise a thread subject line:
 * - Strip redundant "Re:", "Fwd:", "FW:" prefixes (keeps one "Re:" if it was a reply)
 * - Collapse whitespace
 * - Strip Slack formatting (bold, italic, strike, code, links)
 * - Truncate to maxLen characters
 */
export function normaliseSubject(raw: string, opts?: { maxLen?: number }): string {
  const maxLen = opts?.maxLen ?? 200;
  let s = raw.trim();

  // Detect if the original had any "Re:" / "Fwd:" prefix
  const isReply = /^re:/i.test(s);

  // Strip all "Re:", "RE:", "Fwd:", "FW:", "Fw:" prefixes (possibly repeated)
  s = s.replace(/^(re:\s*|fwd?:\s*|fw:\s*)+/gi, "").trim();

  // Clean Slack mrkdwn formatting
  s = cleanSlackFormatting(s);

  // Collapse whitespace / newlines into a single space
  s = s.replace(/\s+/g, " ").trim();

  // Re-add a single "Re:" if it was a reply
  if (isReply && s.length > 0) {
    s = `Re: ${s}`;
  }

  // Truncate
  if (s.length > maxLen) {
    s = s.substring(0, maxLen - 1) + "…";
  }

  return s || "No Subject";
}

/**
 * Strip Slack mrkdwn tokens so the subject reads cleanly:
 *  *bold* → bold, _italic_ → italic, ~strike~ → strike
 *  `code` → code, ```code block``` → code block
 *  <url|label> → label, <url> → url, <@U1234> → @user
 */
function cleanSlackFormatting(text: string): string {
  let s = text;

  // Links:  <https://example.com|Display Text>  →  Display Text
  s = s.replace(/<([^|>]+)\|([^>]+)>/g, "$2");
  // Bare links: <https://example.com>  →  https://example.com
  s = s.replace(/<([^>]+)>/g, "$1");

  // User mentions: @U12345 → @user
  s = s.replace(/@U[A-Z0-9]+/g, "@user");

  // Code blocks (triple backtick)
  s = s.replace(/```[\s\S]*?```/g, (m) =>
    m.replace(/```/g, "").trim()
  );

  // Inline code
  s = s.replace(/`([^`]+)`/g, "$1");

  // Bold / italic / strike
  s = s.replace(/\*([^*]+)\*/g, "$1");
  s = s.replace(/_([^_]+)_/g, "$1");
  s = s.replace(/~([^~]+)~/g, "$1");

  return s;
}

// ---------------------------------------------------------------------------
// Auto-priority rules
// ---------------------------------------------------------------------------

interface PriorityRule {
  priority: ThreadPriority;
  keywords: RegExp;
}

const KEYWORD_RULES: PriorityRule[] = [
  {
    priority: "P0",
    keywords:
      /\b(outage|incident|down|p0|sev[- ]?0|security[- ]?breach|data[- ]?loss|production[- ]?down|system[- ]?failure)\b/i,
  },
  {
    priority: "P1",
    keywords:
      /\b(urgent|critical|asap|escalat(e|ed|ion)|p1|sev[- ]?1|blocker|emergency|immediately|time[- ]?sensitive)\b/i,
  },
  {
    priority: "P2",
    keywords:
      /\b(important|high[- ]?priority|p2|sev[- ]?2|needs[- ]?attention)\b/i,
  },
];

/**
 * VIP / known-sender escalation list.
 * Key = lowercase email or domain; value = minimum priority.
 */
const VIP_SENDERS: Record<string, ThreadPriority> = {
  // Add domains or emails that always deserve escalation, e.g.:
  // "ceo@company.com": "P1",
  // "regulator.gov": "P0",
};

/**
 * Derive an auto-priority from thread content and metadata.
 * Returns the computed priority or null if no rules matched (caller keeps default).
 */
export function deriveAutoPriority(opts: {
  subject: string;
  body?: string;
  senderEmail?: string;
}): ThreadPriority | null {
  const text = `${opts.subject} ${opts.body ?? ""}`;

  // Check keyword rules (most severe first)
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.test(text)) {
      return rule.priority;
    }
  }

  // Check VIP sender
  if (opts.senderEmail) {
    const email = opts.senderEmail.toLowerCase();
    if (VIP_SENDERS[email]) return VIP_SENDERS[email];
    const domain = email.split("@")[1];
    if (domain && VIP_SENDERS[domain]) return VIP_SENDERS[domain];
  }

  return null;
}
