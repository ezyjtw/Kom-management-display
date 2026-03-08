/**
 * Input sanitization and XSS prevention utilities.
 *
 * These functions sanitize user input before storage or display to prevent
 * stored XSS, injection attacks, and data corruption. All sanitization is
 * applied at the API boundary — clean on input, trust on output.
 *
 * Principles:
 *   - Strip HTML tags from text fields (prevents stored XSS)
 *   - Normalize Unicode to NFC form (prevents homograph attacks)
 *   - Limit string lengths to prevent resource exhaustion
 *   - Trim whitespace (prevents display issues)
 *   - Validate email format strictly
 *   - Reject null bytes and control characters
 *
 * Usage:
 *   const cleaned = sanitizeText(userInput);
 *   const safeEmail = sanitizeEmail(emailInput);
 */

/**
 * Strip all HTML tags from a string.
 * Converts common HTML entities back to their characters.
 */
export function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

/**
 * Remove null bytes and control characters (except newlines and tabs).
 * These characters can cause issues in databases, logs, and UI rendering.
 */
export function stripControlChars(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

/**
 * Sanitize a general text field.
 *
 * Applies: strip HTML, strip control chars, normalize Unicode, trim, enforce max length.
 */
export function sanitizeText(input: string, maxLength = 10_000): string {
  if (!input) return "";

  let cleaned = input;
  cleaned = stripControlChars(cleaned);
  cleaned = stripHtml(cleaned);
  cleaned = cleaned.normalize("NFC"); // Normalize Unicode
  cleaned = cleaned.trim();

  if (cleaned.length > maxLength) {
    cleaned = cleaned.substring(0, maxLength);
  }

  return cleaned;
}

/**
 * Sanitize a single-line text field (no newlines allowed).
 * Useful for names, subjects, titles, etc.
 */
export function sanitizeLine(input: string, maxLength = 500): string {
  if (!input) return "";

  let cleaned = sanitizeText(input, maxLength);
  cleaned = cleaned.replace(/[\r\n]/g, " "); // Replace newlines with spaces
  cleaned = cleaned.replace(/\s+/g, " "); // Collapse multiple spaces
  cleaned = cleaned.trim();

  return cleaned;
}

/**
 * Sanitize an email address.
 * Normalizes to lowercase, trims whitespace, validates format.
 * Returns empty string if invalid.
 */
export function sanitizeEmail(input: string): string {
  if (!input) return "";

  const cleaned = input.trim().toLowerCase().normalize("NFC");

  // Basic email format validation
  const emailRegex = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
  if (!emailRegex.test(cleaned) || cleaned.length > 255) {
    return "";
  }

  return cleaned;
}

/**
 * Sanitize a URL.
 * Only allows http/https protocols. Returns empty string if invalid.
 */
export function sanitizeUrl(input: string): string {
  if (!input) return "";

  const trimmed = input.trim();

  try {
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

/**
 * Sanitize a JSON string field.
 * Parses and re-serializes to ensure valid JSON, with size limits.
 */
export function sanitizeJsonString(input: string, maxSizeBytes = 1_000_000): string {
  if (!input) return "{}";

  // Check byte size before parsing
  const byteSize = Buffer.byteLength(input, "utf8");
  if (byteSize > maxSizeBytes) {
    return "{}";
  }

  try {
    const parsed = JSON.parse(input);
    return JSON.stringify(parsed);
  } catch {
    return "{}";
  }
}

/**
 * Sanitize an identifier (slug, key, code).
 * Only allows alphanumeric characters, hyphens, and underscores.
 */
export function sanitizeIdentifier(input: string, maxLength = 100): string {
  if (!input) return "";

  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .substring(0, maxLength);
}

/**
 * Escape a string for safe inclusion in log output.
 * Prevents log injection attacks by escaping newlines and control characters.
 */
export function escapeForLog(input: string, maxLength = 500): string {
  if (!input) return "";

  return input
    .substring(0, maxLength)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, "");
}

/**
 * Deep-sanitize an object's string values.
 * Recursively applies sanitizeText to all string values in an object.
 * Useful for sanitizing entire request bodies.
 */
export function sanitizeObject<T extends Record<string, unknown>>(
  obj: T,
  maxDepth = 5,
): T {
  if (maxDepth <= 0) return obj;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result[key] = sanitizeText(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === "string"
          ? sanitizeText(item)
          : typeof item === "object" && item !== null
            ? sanitizeObject(item as Record<string, unknown>, maxDepth - 1)
            : item,
      );
    } else if (typeof value === "object" && value !== null) {
      result[key] = sanitizeObject(value as Record<string, unknown>, maxDepth - 1);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}
