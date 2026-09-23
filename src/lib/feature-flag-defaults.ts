// Pure data (no imports) so prisma/seed.ts can use it directly.

export const FLAG_DEFAULTS = Object.freeze({
  "ai.enabled": false,
  "ai.compliance_bot": false,
  "people.scoring": false,
  "people.activity_tracking": false,
  "module.usdc_ramp": false,
  "integration.notabene.enabled": false,
  "module.market_ticker": false,
  "module.status_pages": false,
  "iai.drafts.enabled": false,
  "module.fab": false,
} as const);

export type SafetyFlagKey = keyof typeof FLAG_DEFAULTS;

export const SAFETY_FLAG_SEED: ReadonlyArray<{
  key: SafetyFlagKey;
  name: string;
  description: string;
}> = Object.freeze([
  { key: "ai.enabled", name: "AI features", description: "All AI features: briefing, classifier, drafter, AI buttons (H3)" },
  { key: "ai.compliance_bot", name: "Compliance bot", description: "Must stay off unless Compliance approves (H3)" },
  { key: "people.scoring", name: "People scoring", description: "Team scores, employee pages, scoring config (H4)" },
  { key: "people.activity_tracking", name: "Activity tracking", description: "Activity tracker and break/lunch status (H4)" },
  { key: "module.usdc_ramp", name: "USDC ramp", description: "Not a current team process" },
  { key: "integration.notabene.enabled", name: "Notabene integration", description: "Notabene adapter and routes (H11)" },
  { key: "iai.drafts.enabled", name: "IAI drafts", description: "Automated IAI draft issues (spec §10.4); needs the IAI log owner's agreement (CONFIRM-IAI-OWNER)" },
  { key: "module.fab", name: "FAB ICS module", description: "FAB MVP0 instruction register and settlement log (spec §12 TASK-FAB); process is draft, not operational" },
  { key: "module.status_pages", name: "Vendor status pages", description: "Status-page poller (spec §8.6); its hosts must also be added to EGRESS_EXTRA_HOSTS" },
  { key: "module.market_ticker", name: "Market ticker", description: "Non-essential CoinGecko/Etherscan ticker; its hosts must also be added to EGRESS_EXTRA_HOSTS" },
]);
