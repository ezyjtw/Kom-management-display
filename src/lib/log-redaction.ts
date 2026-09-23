/**
 * Log redaction (H8). Applied to every log entry before it is written.
 * Key-based: secrets are removed, identifiers are partially masked.
 * Value-based: wallet addresses and tx hashes are masked wherever they appear.
 */

const SECRET_KEY = /(pass(word)?|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|signature)/i;
const MASK_KEY = /(address|tx[_-]?hash|^hash$|account(no|nos|number|numbers)?$|accountNos?|wallet|client(name)?$|clientName|clientOrPartnerTag|iban|email|phone)/i;

// EVM address / 32-byte hash, bech32 BTC address, and long base58 strings (BTC legacy, Solana, etc.)
const VALUE_PATTERNS: RegExp[] = [
  /\b0x[a-fA-F0-9]{64}\b/g,
  /\b0x[a-fA-F0-9]{40}\b/g,
  /\b(bc1|tb1)[a-z0-9]{25,87}\b/g,
  /\b[a-fA-F0-9]{64}\b/g,
  /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g,
];

function maskMiddle(value: string): string {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function redactString(value: string): string {
  let out = value;
  for (const re of VALUE_PATTERNS) out = out.replace(re, (m) => maskMiddle(m));
  return out;
}

function maskValue(value: unknown): unknown {
  if (typeof value === "string") return maskMiddle(value);
  if (Array.isArray(value)) return value.map(maskValue);
  if (value === null || value === undefined) return value;
  return "[redacted]";
}

export function redactValue(value: unknown, key = "", depth = 0): unknown {
  if (key && SECRET_KEY.test(key)) return value === undefined || value === null || value === "" ? value : "[redacted]";
  if (key && MASK_KEY.test(key)) return maskValue(value);
  if (typeof value === "string") return redactString(value);
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, "", depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactValue(v, k, depth + 1);
  return out;
}
