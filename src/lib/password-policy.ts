/**
 * Password policy enforcement and credential hardening.
 *
 * Enforces enterprise-grade password requirements:
 *   - Minimum 12 characters (NIST SP 800-63B recommends 8+, we exceed)
 *   - At least one uppercase letter
 *   - At least one lowercase letter
 *   - At least one digit
 *   - At least one special character
 *   - Not in the common passwords blocklist
 *   - Not similar to the user's email or name
 *   - Maximum 128 characters (prevents DoS via bcrypt)
 *
 * Also provides:
 *   - Password strength scoring (0-4 scale)
 *   - Bcrypt cost factor enforcement
 *   - Password age checking support
 *
 * Usage:
 *   const result = validatePassword("MyP@ssw0rd123!", { email: "user@example.com" });
 *   if (!result.valid) {
 *     console.log(result.errors); // ["Password must be at least 12 characters"]
 *   }
 */

/** Common passwords that are always rejected, regardless of complexity. */
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "password1234",
  "12345678", "123456789", "1234567890", "123456789012",
  "qwerty123", "qwertyuiop", "letmein123", "welcome123",
  "admin123", "admin1234", "administrator", "changeme",
  "iloveyou", "sunshine", "princess", "football",
  "shadow123", "master123", "monkey123", "dragon123",
  "trustno1", "baseball1", "abc12345", "passw0rd",
  "p@ssw0rd", "p@ssword", "pass1234", "test1234",
  "komainu123", "komainu1234",
]);

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
  strength: PasswordStrength;
}

export type PasswordStrength = 0 | 1 | 2 | 3 | 4;

export interface PasswordContext {
  /** User's email (used to check similarity). */
  email?: string;
  /** User's name (used to check similarity). */
  name?: string;
}

/**
 * Validate a password against the security policy.
 * Returns a detailed result with all failing rules.
 */
export function validatePassword(
  password: string,
  context: PasswordContext = {},
): PasswordValidationResult {
  const errors: string[] = [];

  // Length checks
  if (password.length < 12) {
    errors.push("Password must be at least 12 characters");
  }
  if (password.length > 128) {
    errors.push("Password must be at most 128 characters");
  }

  // Character class requirements
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one digit");
  }
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password)) {
    errors.push("Password must contain at least one special character");
  }

  // Common password check
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push("This password is too common and easily guessed");
  }

  // Similarity checks
  if (context.email) {
    const emailLocal = context.email.split("@")[0].toLowerCase();
    if (emailLocal.length > 3 && password.toLowerCase().includes(emailLocal)) {
      errors.push("Password must not contain your email address");
    }
  }

  if (context.name) {
    const nameParts = context.name.toLowerCase().split(/\s+/);
    for (const part of nameParts) {
      if (part.length > 3 && password.toLowerCase().includes(part)) {
        errors.push("Password must not contain your name");
        break;
      }
    }
  }

  // Repeating characters (e.g., "aaaa" or "1111")
  if (/(.)\1{3,}/.test(password)) {
    errors.push("Password must not contain 4 or more repeating characters");
  }

  // Sequential characters (e.g., "abcd" or "1234")
  if (hasSequentialChars(password, 4)) {
    errors.push("Password must not contain 4 or more sequential characters");
  }

  const strength = calculateStrength(password);

  return {
    valid: errors.length === 0,
    errors,
    strength,
  };
}

/**
 * Calculate password strength on a 0-4 scale.
 *
 * 0 = Very weak, 1 = Weak, 2 = Fair, 3 = Strong, 4 = Very strong
 */
export function calculateStrength(password: string): PasswordStrength {
  let score = 0;

  // Length-based scoring
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  if (password.length >= 20) score++;

  // Character variety
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const varietyCount = [hasUpper, hasLower, hasDigit, hasSpecial].filter(Boolean).length;
  if (varietyCount >= 3) score++;
  if (varietyCount >= 4) score++;

  // Unique characters
  const uniqueChars = new Set(password).size;
  if (uniqueChars >= 8) score++;
  if (uniqueChars >= 12) score++;

  // Normalize to 0-4
  return Math.min(4, Math.floor(score / 2)) as PasswordStrength;
}

/**
 * Check for sequential characters (ascending or descending).
 * E.g., "abcd", "1234", "DCBA"
 */
function hasSequentialChars(password: string, length: number): boolean {
  const lower = password.toLowerCase();

  for (let i = 0; i <= lower.length - length; i++) {
    let ascending = true;
    let descending = true;

    for (let j = 1; j < length; j++) {
      const diff = lower.charCodeAt(i + j) - lower.charCodeAt(i + j - 1);
      if (diff !== 1) ascending = false;
      if (diff !== -1) descending = false;
    }

    if (ascending || descending) return true;
  }

  return false;
}

/**
 * Recommended bcrypt cost factor.
 * OWASP recommends at least 10; we use 12 for stronger hashing.
 * This takes ~250ms on modern hardware — acceptable for login operations.
 */
export const BCRYPT_ROUNDS = 12;

/**
 * Check if a password hash uses sufficient bcrypt rounds.
 * Bcrypt hashes encode the cost factor: $2b$12$...
 */
export function isBcryptStrengthSufficient(hash: string): boolean {
  const match = hash.match(/^\$2[aby]?\$(\d+)\$/);
  if (!match) return false;
  return parseInt(match[1], 10) >= BCRYPT_ROUNDS;
}

/**
 * Get a human-readable label for a password strength score.
 */
export function strengthLabel(strength: PasswordStrength): string {
  const labels: Record<PasswordStrength, string> = {
    0: "Very weak",
    1: "Weak",
    2: "Fair",
    3: "Strong",
    4: "Very strong",
  };
  return labels[strength];
}
