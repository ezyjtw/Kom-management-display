/**
 * Admin-configured regular expressions run against external text (GX release
 * notes, Komainu audit event names, import filenames). A pattern with nested
 * quantifiers such as (a+)+ can backtrack catastrophically (ReDoS), so such
 * patterns are refused when saved and ignored when run, and the text tested is
 * capped. The check is a conservative heuristic: it refuses a quantified group
 * that itself contains a quantifier, and backreferences.
 */

export const MAX_PATTERN_LENGTH = 300;
export const MAX_TEST_LENGTH = 20_000;

const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*(?:[+*]|\{\d+,?\d*\})(?:[^()\\]|\\.)*\)\s*(?:[+*]|\{\d+,?\d*\})/;
const BACKREFERENCE = /\\[1-9]|\\k</;

/** Why the pattern is refused, or null when it is acceptable. */
export function unsafeRegexReason(pattern: string, flags = ""): string | null {
  if (pattern.length > MAX_PATTERN_LENGTH) return `Pattern is longer than ${MAX_PATTERN_LENGTH} characters`;
  try {
    new RegExp(pattern, flags);
  } catch {
    return "Not a valid regular expression";
  }
  if (NESTED_QUANTIFIER.test(pattern)) return "Nested quantifiers such as (a+)+ are not allowed (catastrophic backtracking)";
  if (BACKREFERENCE.test(pattern)) return "Backreferences are not allowed";
  return null;
}

/** A compiled pattern, or null when it is invalid or unsafe. */
export function safeRegex(pattern: string, flags = ""): RegExp | null {
  return unsafeRegexReason(pattern, flags) ? null : new RegExp(pattern, flags);
}

/** Test against at most MAX_TEST_LENGTH characters of the text. */
export function boundedTest(re: RegExp, text: string): boolean {
  return re.test(text.length > MAX_TEST_LENGTH ? text.slice(0, MAX_TEST_LENGTH) : text);
}
