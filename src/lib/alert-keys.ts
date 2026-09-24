import { randomUUID } from "crypto";

/**
 * Rule code and dedupe key for alerts raised by the pre-engine code paths.
 * The rule code is the legacy `type`; each alert gets its own dedupe key, so
 * existing behaviour (these paths dedupe themselves, if at all) is unchanged.
 */
export function legacyAlertKeys(type: string): { ruleCode: string; dedupeKey: string } {
  return { ruleCode: type, dedupeKey: randomUUID() };
}

export function withLegacyAlertKeys<T extends { type: string }>(alert: T): T & { ruleCode: string; dedupeKey: string } {
  return { ...alert, ...legacyAlertKeys(alert.type) };
}
