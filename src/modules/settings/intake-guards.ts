import type { SettingKey } from "@/modules/settings/registry";
import { getSetting } from "@/modules/settings/settings";

/**
 * Preconditions for switching intake routes on (spec §9.1). Returns a list of
 * problems; empty means the change is allowed.
 */
export async function checkSettingChange(key: SettingKey, value: unknown): Promise<string[]> {
  const problems: string[] = [];
  if (key === "intake.slack.route" && value === "kommand") {
    if (!(await getSetting("intake.slack.komainuTeamId"))) problems.push("Set intake.slack.komainuTeamId first (needed to tell clients from staff).");
    if (!(await getSetting("intake.jsm.serviceDeskId"))) problems.push("Set intake.jsm.serviceDeskId first.");
    if (!(await getSetting("intake.jsm.requestTypeId"))) problems.push("Set intake.jsm.requestTypeId first.");
  }
  if (key === "intake.slack.route" && value === "jsm_native") {
    if (!(await getSetting("intake.slack.jsmNativeVerification"))) {
      problems.push("Record the completed JSM Slack verification (docs/phase1/jsm-slack-verification.md) before enabling jsm_native.");
    }
  }
  if (key === "intake.email.enabled" && value === true) {
    if ((await getSetting("intake.internalEmailDomains")).length === 0) problems.push("Set intake.internalEmailDomains first (needed to tell clients from staff).");
    if (!(await getSetting("intake.jsm.serviceDeskId")) || !(await getSetting("intake.jsm.requestTypeId"))) problems.push("Set the JSM service desk and request type first.");
  }
  if (key === "intake.teams.enabled" && value === true) {
    if (!(await getSetting("intake.teams.komainuTenantId"))) problems.push("Set intake.teams.komainuTenantId first.");
    if (!(await getSetting("intake.jsm.serviceDeskId")) || !(await getSetting("intake.jsm.requestTypeId"))) problems.push("Set the JSM service desk and request type first.");
  }
  return problems;
}
