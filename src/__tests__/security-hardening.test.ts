/**
 * Security hardening tests.
 * Tests webhook verification, sanitization, password policy,
 * encryption, idempotency, and metrics collection.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createHmac } from "crypto";
import { verifyHmacSignature } from "@/lib/webhook-verify";
import {
  sanitizeText,
  sanitizeLine,
  sanitizeEmail,
  sanitizeUrl,
  sanitizeIdentifier,
  stripHtml,
  stripControlChars,
  escapeForLog,
  sanitizeObject,
} from "@/lib/sanitize";
import {
  validatePassword,
  calculateStrength,
  isBcryptStrengthSufficient,
  strengthLabel,
} from "@/lib/password-policy";
import {
  encrypt,
  decrypt,
  isEncrypted,
  safeDecrypt,
  safeEncrypt,
  maskSensitive,
  clearKeyCache,
} from "@/lib/encryption";
import { metrics, recordApiRequest } from "@/lib/metrics";
import { getIdempotencyStats } from "@/lib/idempotency";
import {
  createTransactionConfirmationSchema,
  confirmationActionSchema,
  upsertFeatureFlagSchema,
  searchQuerySchema,
  reportQuerySchema,
  enqueueJobSchema,
  validateBody,
} from "@/lib/validation";

// ─── Webhook Verification ───

describe("Webhook Signature Verification", () => {
  it("verifies a valid HMAC-SHA256 signature", () => {
    const body = '{"event":"test"}';
    const secret = "test-secret-key";
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyHmacSignature(body, signature, secret)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    expect(verifyHmacSignature("body", "invalid-sig", "secret")).toBe(false);
  });

  it("rejects when signature lengths differ", () => {
    expect(verifyHmacSignature("body", "short", "secret")).toBe(false);
  });

  it("supports prefix option", () => {
    const body = "test";
    const secret = "key";
    const hash = createHmac("sha256", secret).update(body).digest("hex");
    const signature = `sha256=${hash}`;
    expect(verifyHmacSignature(body, signature, secret, { prefix: "sha256=" })).toBe(true);
  });
});

// ─── Input Sanitization ───

describe("Input Sanitization", () => {
  it("strips HTML tags", () => {
    expect(stripHtml("<script>alert('xss')</script>")).toBe("alert('xss')");
    expect(stripHtml("<b>bold</b> text")).toBe("bold text");
    expect(stripHtml("no tags")).toBe("no tags");
  });

  it("strips control characters", () => {
    expect(stripControlChars("hello\x00world")).toBe("helloworld");
    expect(stripControlChars("keep\nnewlines")).toBe("keep\nnewlines");
    expect(stripControlChars("keep\ttabs")).toBe("keep\ttabs");
  });

  it("sanitizes text fields", () => {
    expect(sanitizeText("  <b>Hello</b>  ")).toBe("Hello");
    expect(sanitizeText("normal text")).toBe("normal text");
    expect(sanitizeText("a".repeat(20000), 100)).toHaveLength(100);
  });

  it("sanitizes single-line fields", () => {
    expect(sanitizeLine("line one\nline two")).toBe("line one line two");
    expect(sanitizeLine("  extra   spaces  ")).toBe("extra spaces");
  });

  it("sanitizes email addresses", () => {
    expect(sanitizeEmail("  User@Example.COM  ")).toBe("user@example.com");
    expect(sanitizeEmail("invalid")).toBe("");
    expect(sanitizeEmail("valid@test.co")).toBe("valid@test.co");
  });

  it("sanitizes URLs", () => {
    expect(sanitizeUrl("https://example.com/path")).toBe("https://example.com/path");
    expect(sanitizeUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeUrl("ftp://files.com")).toBe("");
    expect(sanitizeUrl("not a url")).toBe("");
  });

  it("sanitizes identifiers", () => {
    expect(sanitizeIdentifier("My Feature Flag!")).toBe("myfeatureflag");
    expect(sanitizeIdentifier("valid_key-123")).toBe("valid_key-123");
  });

  it("escapes strings for log output", () => {
    expect(escapeForLog("line1\nline2")).toBe("line1\\nline2");
    expect(escapeForLog("tab\there")).toBe("tab\\there");
    expect(escapeForLog("a".repeat(1000))).toHaveLength(500);
  });

  it("deep-sanitizes objects", () => {
    const input = {
      name: "<script>xss</script>",
      count: 42,
      nested: { value: "<b>bold</b>" },
      tags: ["<i>tag</i>", "clean"],
    };
    const result = sanitizeObject(input);
    expect(result.name).toBe("xss");
    expect(result.count).toBe(42);
    expect((result.nested as any).value).toBe("bold");
    expect(result.tags[0]).toBe("tag");
    expect(result.tags[1]).toBe("clean");
  });
});

// ─── Password Policy ───

describe("Password Policy", () => {
  it("rejects passwords shorter than 12 characters", () => {
    const result = validatePassword("Short1!a");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Password must be at least 12 characters");
  });

  it("requires uppercase letters", () => {
    const result = validatePassword("alllowercase1234!");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("uppercase"))).toBe(true);
  });

  it("requires lowercase letters", () => {
    const result = validatePassword("ALLUPPERCASE1234!");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("lowercase"))).toBe(true);
  });

  it("requires digits", () => {
    const result = validatePassword("NoDigitsHere!@#$");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("digit"))).toBe(true);
  });

  it("requires special characters", () => {
    const result = validatePassword("NoSpecials12345");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("special"))).toBe(true);
  });

  it("rejects common passwords", () => {
    const result = validatePassword("password1234");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("common"))).toBe(true);
  });

  it("rejects passwords containing email", () => {
    const result = validatePassword("john.smith!A1234", { email: "john.smith@example.com" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("email"))).toBe(true);
  });

  it("rejects passwords containing name", () => {
    const result = validatePassword("JohnDoe!#1234567", { name: "John Doe" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("name"))).toBe(true);
  });

  it("rejects repeating characters", () => {
    const result = validatePassword("AAAA!@#$bc123456");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("repeating"))).toBe(true);
  });

  it("rejects sequential characters", () => {
    const result = validatePassword("Abcd!@#$567890");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("sequential"))).toBe(true);
  });

  it("accepts a strong password", () => {
    const result = validatePassword("Kx$9mR#2pL!wQz7n");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("calculates password strength", () => {
    expect(calculateStrength("weak")).toBe(0);
    expect(calculateStrength("Kx$9mR#2pL!wQz7nBvF")).toBeGreaterThanOrEqual(3);
  });

  it("checks bcrypt strength", () => {
    expect(isBcryptStrengthSufficient("$2b$12$abcdef")).toBe(true);
    expect(isBcryptStrengthSufficient("$2b$10$abcdef")).toBe(false);
    expect(isBcryptStrengthSufficient("not-a-hash")).toBe(false);
  });

  it("returns strength labels", () => {
    expect(strengthLabel(0)).toBe("Very weak");
    expect(strengthLabel(4)).toBe("Very strong");
  });
});

// ─── Encryption ───

describe("Encryption", () => {
  const originalSecret = process.env.ENCRYPTION_SECRET;

  beforeEach(() => {
    process.env.ENCRYPTION_SECRET = "a-test-encryption-secret-that-is-at-least-32-chars-long";
    clearKeyCache();
  });

  it("encrypts and decrypts a string", () => {
    const plaintext = "sensitive-api-key-12345";
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.startsWith("enc:")).toBe(true);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it("produces different ciphertexts for same input (unique IV)", () => {
    const encrypted1 = encrypt("same-value");
    const encrypted2 = encrypt("same-value");
    expect(encrypted1).not.toBe(encrypted2);
  });

  it("detects encrypted values", () => {
    expect(isEncrypted("enc:abc123")).toBe(true);
    expect(isEncrypted("plaintext")).toBe(false);
    expect(isEncrypted(encrypt("test"))).toBe(true);
  });

  it("safe decrypt returns original for non-encrypted values", () => {
    expect(safeDecrypt("plain-value")).toBe("plain-value");
    expect(safeDecrypt("")).toBe("");
  });

  it("safe encrypt prevents double encryption", () => {
    const first = safeEncrypt("value");
    const second = safeEncrypt(first);
    expect(second).toBe(first);
    expect(decrypt(second)).toBe("value");
  });

  it("masks sensitive values", () => {
    expect(maskSensitive("1234567890")).toBe("1234***7890");
    expect(maskSensitive("short")).toBe("***");
    expect(maskSensitive("")).toBe("");
  });

  it("handles empty strings", () => {
    expect(encrypt("")).toBe("");
    expect(decrypt("")).toBe("");
  });

  afterAll(() => {
    if (originalSecret) {
      process.env.ENCRYPTION_SECRET = originalSecret;
    } else {
      delete process.env.ENCRYPTION_SECRET;
    }
  });
});

// ─── Metrics ───

describe("Metrics Collection", () => {
  beforeEach(() => {
    metrics.reset();
  });

  it("increments counters", () => {
    metrics.incrementCounter("test_counter");
    metrics.incrementCounter("test_counter");
    metrics.incrementCounter("test_counter");
    expect(metrics.getValue("test_counter")).toBe(3);
  });

  it("supports labeled counters", () => {
    metrics.incrementCounter("requests", { method: "GET" });
    metrics.incrementCounter("requests", { method: "POST" });
    metrics.incrementCounter("requests", { method: "GET" });

    expect(metrics.getValue("requests", { method: "GET" })).toBe(2);
    expect(metrics.getValue("requests", { method: "POST" })).toBe(1);
  });

  it("sets gauge values", () => {
    metrics.setGauge("active_connections", 42);
    expect(metrics.getValue("active_connections")).toBe(42);

    metrics.setGauge("active_connections", 10);
    expect(metrics.getValue("active_connections")).toBe(10);
  });

  it("records histogram values", () => {
    metrics.recordHistogram("response_time", 100);
    metrics.recordHistogram("response_time", 200);
    metrics.recordHistogram("response_time", 50);

    const snapshot = metrics.getSnapshot();
    const histogram = snapshot["response_time"] as any;
    expect(histogram.type).toBe("histogram");
    expect(histogram.count).toBe(3);
    expect(histogram.min).toBe(50);
    expect(histogram.max).toBe(200);
    expect(histogram.avg).toBe(117); // Math.round(350/3)
  });

  it("records API requests with convenience helper", () => {
    recordApiRequest("GET", "/api/health", 200, 15);
    recordApiRequest("GET", "/api/health", 200, 25);
    recordApiRequest("POST", "/api/users", 500, 100);

    expect(metrics.getValue("api_requests_total", { method: "GET", path: "/api/health" })).toBe(2);
    expect(metrics.getValue("api_server_errors_total", { method: "POST", path: "/api/users" })).toBe(1);
  });

  it("returns null for unknown metrics", () => {
    expect(metrics.getValue("nonexistent")).toBeNull();
  });

  it("produces a serializable snapshot", () => {
    metrics.incrementCounter("test", { label: "a" });
    metrics.setGauge("gauge", 5);
    metrics.recordHistogram("hist", 100);

    const snapshot = metrics.getSnapshot();
    const json = JSON.stringify(snapshot);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

// ─── Idempotency ───

describe("Idempotency", () => {
  it("returns stats about the idempotency cache", () => {
    const stats = getIdempotencyStats();
    expect(stats).toHaveProperty("totalEntries");
    expect(stats).toHaveProperty("processingCount");
    expect(stats).toHaveProperty("oldestEntryAge");
  });
});

// ─── Validation Schemas ───

describe("Extended Validation Schemas", () => {
  it("validates transaction confirmation input", () => {
    const valid = validateBody(createTransactionConfirmationSchema, {
      transactionId: "tx-123",
      asset: "BTC",
      amount: 1.5,
      direction: "OUT",
    });
    expect(valid.success).toBe(true);

    const invalid = validateBody(createTransactionConfirmationSchema, {
      transactionId: "",
      amount: -1,
    });
    expect(invalid.success).toBe(false);
  });

  it("validates confirmation actions", () => {
    const valid = validateBody(confirmationActionSchema, {
      action: "acknowledge",
      confirmationId: "conf-123",
    });
    expect(valid.success).toBe(true);

    const invalid = validateBody(confirmationActionSchema, {
      action: "invalid_action",
      confirmationId: "conf-123",
    });
    expect(invalid.success).toBe(false);
  });

  it("validates feature flag upsert", () => {
    const valid = validateBody(upsertFeatureFlagSchema, {
      key: "dark_mode",
      name: "Dark Mode",
    });
    expect(valid.success).toBe(true);

    const invalid = validateBody(upsertFeatureFlagSchema, {
      key: "Invalid Key!",
      name: "",
    });
    expect(invalid.success).toBe(false);
  });

  it("validates search queries", () => {
    const valid = validateBody(searchQuerySchema, { q: "test query", limit: 10 });
    expect(valid.success).toBe(true);

    const tooShort = validateBody(searchQuerySchema, { q: "a" });
    expect(tooShort.success).toBe(false);
  });

  it("validates report queries", () => {
    const valid = validateBody(reportQuerySchema, { type: "daily_digest" });
    expect(valid.success).toBe(true);

    const invalid = validateBody(reportQuerySchema, { type: "nonexistent" });
    expect(invalid.success).toBe(false);
  });

  it("validates job enqueueing", () => {
    const valid = validateBody(enqueueJobSchema, { type: "sync_slack" });
    expect(valid.success).toBe(true);

    const invalid = validateBody(enqueueJobSchema, { type: "invalid_job" });
    expect(invalid.success).toBe(false);
  });
});
