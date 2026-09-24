/**
 * Security events that also raise an immediate alert (spec §17.7): non-SSO
 * sign-in (ALR-SEC-04) and the export daily cap (ALR-SEC-03). Audit-only
 * events are in ./record.ts.
 */
import { logger } from "@/lib/logger";
import { raiseAlert } from "@/modules/alerting/raise";
import { SECURITY_ACTIONS } from "@/modules/security/actions";
import { writeSecurityAudit } from "@/modules/security/record";

export { SECURITY_ACTIONS };
export * from "@/modules/security/record";

async function alertSafely(input: Parameters<typeof raiseAlert>[0]): Promise<void> {
  try {
    await raiseAlert(input);
  } catch (error) {
    logger.error("Security alert could not be raised", { ruleCode: input.ruleCode, error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * A production sign-in that did not come through Entra ID (break-glass or a
 * misconfiguration). Always raises ALR-SEC-04 (critical).
 */
export async function recordNonSsoLogin(input: { userId: string | null; provider: string }): Promise<void> {
  await writeSecurityAudit(SECURITY_ACTIONS.nonSsoLogin, "session", input.userId ?? "unknown", input.userId, {
    summary: `Production sign-in through ${input.provider}, not Entra ID`,
    metadata: { provider: input.provider },
  });
  await alertSafely({
    ruleCode: "ALR-SEC-04",
    dedupeKey: `${input.provider}:${input.userId ?? "unknown"}:${new Date().toISOString().slice(0, 10)}`,
    message: `Production sign-in through "${input.provider}" instead of Entra ID. Confirm this was an approved break-glass use and review it.`,
  });
}

/** A user went over the daily export cap (ALR-SEC-03). */
export async function recordExportCapExceeded(input: { userId: string; day: string; count: number; cap: number; path: string }): Promise<void> {
  await writeSecurityAudit(SECURITY_ACTIONS.exportCapExceeded, "export", input.path, input.userId, {
    summary: `Daily export cap exceeded (${input.count} > ${input.cap})`,
    metadata: { day: input.day, count: input.count, cap: input.cap },
  });
  await alertSafely({
    ruleCode: "ALR-SEC-03",
    dedupeKey: `${input.userId}:${input.day}`,
    message: `A user requested ${input.count} exports today, above the daily cap of ${input.cap}. Further exports are refused until tomorrow (UTC).`,
  });
}
