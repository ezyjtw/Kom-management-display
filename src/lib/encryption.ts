/**
 * Encryption-at-rest utility for sensitive fields.
 *
 * Provides AES-256-GCM authenticated encryption for protecting sensitive
 * data stored in the database (API keys, personal data, etc.).
 *
 * Key management:
 *   - Encryption key is derived from ENCRYPTION_SECRET env var using PBKDF2
 *   - Key derivation uses a fixed salt + high iteration count
 *   - Each encryption operation generates a unique IV (nonce)
 *   - The auth tag is appended to the ciphertext for integrity verification
 *
 * Storage format:
 *   Base64 of: [12-byte IV] + [ciphertext] + [16-byte auth tag]
 *
 * Prefixed with "enc:" to distinguish encrypted values from plaintext,
 * allowing gradual migration of existing data.
 *
 * Usage:
 *   const encrypted = encrypt("sensitive-api-key");
 *   // → "enc:base64string..."
 *
 *   const decrypted = decrypt(encrypted);
 *   // → "sensitive-api-key"
 *
 *   if (isEncrypted(value)) { ... }
 */

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from "crypto";
import { logger } from "@/lib/logger";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM recommended IV length
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits
const PBKDF2_ITERATIONS = 100_000;
const ENCRYPTED_PREFIX = "enc:";

// Fixed salt for key derivation. In production, this should be a
// deployment-specific value stored securely alongside the secret.
const KEY_DERIVATION_SALT = "kom-management-display-v1";

let derivedKey: Buffer | null = null;

/**
 * Derive the encryption key from the environment secret.
 * Uses PBKDF2 with SHA-512 for key stretching.
 * Caches the derived key in memory for performance.
 */
function getEncryptionKey(): Buffer {
  if (derivedKey) return derivedKey;

  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      "ENCRYPTION_SECRET environment variable is required for encryption. " +
      "Generate one with: openssl rand -hex 32",
    );
  }

  if (secret.length < 32) {
    throw new Error("ENCRYPTION_SECRET must be at least 32 characters long");
  }

  derivedKey = pbkdf2Sync(
    secret,
    KEY_DERIVATION_SALT,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    "sha512",
  );

  return derivedKey;
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * Returns a prefixed base64 string: "enc:<base64(iv + ciphertext + authTag)>"
 *
 * @throws if ENCRYPTION_SECRET is not configured
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return plaintext;

  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Pack: IV + ciphertext + authTag
  const packed = Buffer.concat([iv, encrypted, authTag]);

  return ENCRYPTED_PREFIX + packed.toString("base64");
}

/**
 * Decrypt an encrypted string.
 *
 * Accepts both prefixed ("enc:...") and raw base64 strings.
 * Returns the original plaintext.
 *
 * @throws if decryption fails (wrong key, tampered data, etc.)
 */
export function decrypt(encryptedValue: string): string {
  if (!encryptedValue) return encryptedValue;

  // Strip prefix if present
  const base64Data = encryptedValue.startsWith(ENCRYPTED_PREFIX)
    ? encryptedValue.substring(ENCRYPTED_PREFIX.length)
    : encryptedValue;

  const key = getEncryptionKey();
  const packed = Buffer.from(base64Data, "base64");

  if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Invalid encrypted data: too short");
  }

  // Unpack: IV + ciphertext + authTag
  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(packed.length - AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH, packed.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Check if a value appears to be encrypted (has the "enc:" prefix).
 */
export function isEncrypted(value: string): boolean {
  return value?.startsWith(ENCRYPTED_PREFIX) ?? false;
}

/**
 * Safely decrypt a value, returning the original if decryption fails.
 * Useful for gradual migration where some values may not yet be encrypted.
 */
export function safeDecrypt(value: string): string {
  if (!value || !isEncrypted(value)) return value;

  try {
    return decrypt(value);
  } catch (error) {
    logger.warn("Failed to decrypt value, returning as-is", {
      error: error instanceof Error ? error.message : String(error),
    });
    return value;
  }
}

/**
 * Encrypt a value only if it isn't already encrypted.
 * Prevents double-encryption.
 */
export function safeEncrypt(value: string): string {
  if (!value || isEncrypted(value)) return value;
  return encrypt(value);
}

/**
 * Mask a sensitive value for display/logging.
 * Shows only the first 4 and last 4 characters.
 */
export function maskSensitive(value: string, visibleChars = 4): string {
  if (!value) return "";
  if (value.length <= visibleChars * 2) return "***";

  return (
    value.substring(0, visibleChars) +
    "***" +
    value.substring(value.length - visibleChars)
  );
}

/**
 * Re-encrypt a value with the current key.
 * Useful after key rotation — decrypt with old key, re-encrypt with new.
 */
export function reEncrypt(encryptedValue: string): string {
  const plaintext = decrypt(encryptedValue);
  return encrypt(plaintext);
}

/** Clear the cached derived key (for testing or key rotation). */
export function clearKeyCache(): void {
  derivedKey = null;
}
