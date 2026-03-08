/**
 * Webhook signature verification for incoming webhooks.
 *
 * Supports:
 *   - Slack: HMAC-SHA256 using X-Slack-Signature + X-Slack-Request-Timestamp
 *   - Jira:  HMAC-SHA256 using X-Hub-Signature header
 *   - Generic: Configurable HMAC verification for any webhook provider
 *
 * All verification functions use constant-time comparison to prevent
 * timing attacks on the signature.
 *
 * Usage:
 *   const isValid = await verifySlackWebhook(request);
 *   if (!isValid) return apiError("Invalid signature", 401);
 */

import { createHmac, timingSafeEqual } from "crypto";
import { logger } from "@/lib/logger";

/**
 * Verify a Slack webhook signature.
 *
 * Slack signs payloads with HMAC-SHA256 using the signing secret.
 * The signature is: v0=HMAC-SHA256(signingSecret, "v0:{timestamp}:{body}")
 *
 * @see https://api.slack.com/authentication/verifying-requests-from-slack
 */
export async function verifySlackWebhook(
  body: string,
  timestamp: string | null,
  signature: string | null,
): Promise<boolean> {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    logger.warn("SLACK_SIGNING_SECRET not configured, skipping webhook verification");
    return true; // Allow in development when not configured
  }

  if (!timestamp || !signature) {
    logger.security("Slack webhook missing timestamp or signature headers");
    return false;
  }

  // Prevent replay attacks: reject requests older than 5 minutes
  const requestTime = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - requestTime) > 300) {
    logger.security("Slack webhook timestamp too old", {
      requestTime,
      serverTime: now,
      diffSeconds: Math.abs(now - requestTime),
    });
    return false;
  }

  // Compute expected signature
  const sigBasestring = `v0:${timestamp}:${body}`;
  const expectedSignature =
    "v0=" + createHmac("sha256", signingSecret).update(sigBasestring).digest("hex");

  // Constant-time comparison
  try {
    const expected = Buffer.from(expectedSignature, "utf8");
    const received = Buffer.from(signature, "utf8");

    if (expected.length !== received.length) {
      logger.security("Slack webhook signature length mismatch");
      return false;
    }

    const valid = timingSafeEqual(expected, received);
    if (!valid) {
      logger.security("Slack webhook signature mismatch");
    }
    return valid;
  } catch {
    logger.security("Slack webhook signature verification error");
    return false;
  }
}

/**
 * Verify a Jira webhook signature.
 *
 * Jira Cloud uses a shared secret to sign webhook payloads.
 * The signature header contains: sha256=<hex-digest>
 *
 * @see https://developer.atlassian.com/cloud/jira/platform/webhooks/
 */
export async function verifyJiraWebhook(
  body: string,
  signatureHeader: string | null,
): Promise<boolean> {
  const secret = process.env.JIRA_WEBHOOK_SECRET;
  if (!secret) {
    logger.warn("JIRA_WEBHOOK_SECRET not configured, skipping webhook verification");
    return true; // Allow in development when not configured
  }

  if (!signatureHeader) {
    logger.security("Jira webhook missing signature header");
    return false;
  }

  const expectedSignature =
    "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

  try {
    const expected = Buffer.from(expectedSignature, "utf8");
    const received = Buffer.from(signatureHeader, "utf8");

    if (expected.length !== received.length) {
      logger.security("Jira webhook signature length mismatch");
      return false;
    }

    const valid = timingSafeEqual(expected, received);
    if (!valid) {
      logger.security("Jira webhook signature mismatch");
    }
    return valid;
  } catch {
    logger.security("Jira webhook signature verification error");
    return false;
  }
}

/**
 * Generic HMAC webhook verification.
 *
 * Supports any provider that sends an HMAC signature in a header.
 * Configurable algorithm (default: sha256) and prefix (e.g., "sha256=").
 */
export function verifyHmacSignature(
  body: string,
  signature: string,
  secret: string,
  options: {
    algorithm?: string;
    prefix?: string;
  } = {},
): boolean {
  const algorithm = options.algorithm ?? "sha256";
  const prefix = options.prefix ?? "";

  const expectedSignature =
    prefix + createHmac(algorithm, secret).update(body).digest("hex");

  try {
    const expected = Buffer.from(expectedSignature, "utf8");
    const received = Buffer.from(signature, "utf8");

    if (expected.length !== received.length) return false;
    return timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}
