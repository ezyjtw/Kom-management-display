/**
 * Authorization types and permission matrix.
 *
 * This is the single source of truth for what each role can do.
 * Every route handler must reference this matrix.
 */

export type Role = "admin" | "lead" | "employee" | "auditor";

export type Resource =
  | "employee"
  | "score"
  | "scoring_config"
  | "thread"
  | "thread_note"
  | "alert"
  | "project"
  | "incident"
  | "travel_rule_case"
  | "daily_check"
  | "staking_wallet"
  | "settlement"
  | "screening"
  | "usdc_ramp"
  | "token_review"
  | "export"
  | "audit_log"
  | "user"
  | "branding"
  | "transaction_confirmation"
  | "feature_flag"
  | "session"
  | "background_job"
  | "report"
  | "metrics";

export type Action =
  | "view"
  | "view_own"
  | "view_team"
  | "create"
  | "update"
  | "delete"
  | "assign"
  | "reassign"
  | "acknowledge"
  | "resolve"
  | "escalate"
  | "override"
  | "export"
  | "configure"
  | "approve";

export type ScopeType = "all" | "team" | "own" | "none";

export interface Permission {
  actions: Action[];
  scope: ScopeType;
}

/**
 * Authorization matrix: Role → Resource → Permission.
 * This defines the complete access control model for the platform.
 */
export const AUTHORIZATION_MATRIX: Record<Role, Partial<Record<Resource, Permission>>> = {
  admin: {
    employee:         { actions: ["view", "create", "update", "delete"], scope: "all" },
    score:            { actions: ["view", "create", "update", "override"], scope: "all" },
    scoring_config:   { actions: ["view", "create", "update", "configure", "approve"], scope: "all" },
    thread:           { actions: ["view", "create", "update", "assign", "reassign", "resolve"], scope: "all" },
    thread_note:      { actions: ["view", "create"], scope: "all" },
    alert:            { actions: ["view", "update", "acknowledge", "resolve"], scope: "all" },
    project:          { actions: ["view", "create", "update", "delete"], scope: "all" },
    incident:         { actions: ["view", "create", "update", "resolve", "escalate"], scope: "all" },
    travel_rule_case: { actions: ["view", "create", "update", "resolve", "assign", "escalate"], scope: "all" },
    daily_check:      { actions: ["view", "create", "update"], scope: "all" },
    staking_wallet:   { actions: ["view", "create", "update"], scope: "all" },
    settlement:       { actions: ["view", "create", "update", "approve"], scope: "all" },
    screening:        { actions: ["view", "create", "update"], scope: "all" },
    usdc_ramp:        { actions: ["view", "create", "update", "approve"], scope: "all" },
    token_review:     { actions: ["view", "create", "update", "approve"], scope: "all" },
    export:           { actions: ["view", "export"], scope: "all" },
    audit_log:        { actions: ["view"], scope: "all" },
    user:             { actions: ["view", "create", "update", "delete"], scope: "all" },
    branding:         { actions: ["view", "update"], scope: "all" },
    transaction_confirmation: { actions: ["view", "create", "acknowledge", "approve", "escalate"], scope: "all" },
    feature_flag:     { actions: ["view", "create", "update", "delete", "configure"], scope: "all" },
    session:          { actions: ["view", "delete"], scope: "all" },
    background_job:   { actions: ["view", "create", "configure"], scope: "all" },
    report:           { actions: ["view", "create", "export"], scope: "all" },
    metrics:          { actions: ["view"], scope: "all" },
  },
  lead: {
    employee:         { actions: ["view", "update"], scope: "team" },
    score:            { actions: ["view", "create", "update"], scope: "team" },
    scoring_config:   { actions: ["view"], scope: "all" },
    thread:           { actions: ["view", "create", "update", "assign", "reassign", "resolve"], scope: "team" },
    thread_note:      { actions: ["view", "create"], scope: "team" },
    alert:            { actions: ["view", "update", "acknowledge", "resolve"], scope: "team" },
    project:          { actions: ["view", "create", "update"], scope: "team" },
    incident:         { actions: ["view", "create", "update", "resolve", "escalate"], scope: "all" },
    travel_rule_case: { actions: ["view", "create", "update", "resolve", "assign", "escalate"], scope: "team" },
    daily_check:      { actions: ["view", "create", "update"], scope: "team" },
    staking_wallet:   { actions: ["view", "update"], scope: "all" },
    settlement:       { actions: ["view", "update", "approve"], scope: "all" },
    screening:        { actions: ["view", "update"], scope: "all" },
    usdc_ramp:        { actions: ["view", "update", "approve"], scope: "all" },
    token_review:     { actions: ["view", "update"], scope: "all" },
    export:           { actions: ["view", "export"], scope: "team" },
    audit_log:        { actions: ["view"], scope: "team" },
    user:             { actions: ["view"], scope: "team" },
    branding:         { actions: ["view"], scope: "all" },
    transaction_confirmation: { actions: ["view", "acknowledge", "approve", "escalate"], scope: "team" },
    feature_flag:     { actions: ["view"], scope: "all" },
    session:          { actions: ["view", "delete"], scope: "own" },
    background_job:   { actions: ["view"], scope: "all" },
    report:           { actions: ["view", "create", "export"], scope: "team" },
    metrics:          { actions: ["view"], scope: "all" },
  },
  employee: {
    employee:         { actions: ["view_own"], scope: "own" },
    score:            { actions: ["view_own"], scope: "own" },
    scoring_config:   { actions: ["view"], scope: "all" },
    thread:           { actions: ["view", "update", "resolve"], scope: "own" },
    thread_note:      { actions: ["view", "create"], scope: "own" },
    alert:            { actions: ["view", "acknowledge"], scope: "own" },
    project:          { actions: ["view"], scope: "team" },
    incident:         { actions: ["view", "create"], scope: "all" },
    travel_rule_case: { actions: ["view", "update"], scope: "own" },
    daily_check:      { actions: ["view", "update"], scope: "own" },
    staking_wallet:   { actions: ["view"], scope: "all" },
    settlement:       { actions: ["view"], scope: "all" },
    screening:        { actions: ["view"], scope: "all" },
    usdc_ramp:        { actions: ["view"], scope: "all" },
    token_review:     { actions: ["view"], scope: "all" },
    export:           { actions: [], scope: "none" },
    audit_log:        { actions: [], scope: "none" },
    user:             { actions: [], scope: "none" },
    branding:         { actions: ["view"], scope: "all" },
    transaction_confirmation: { actions: ["view", "acknowledge"], scope: "own" },
    feature_flag:     { actions: ["view"], scope: "all" },
    session:          { actions: ["view", "delete"], scope: "own" },
    background_job:   { actions: [], scope: "none" },
    report:           { actions: ["view"], scope: "own" },
    metrics:          { actions: [], scope: "none" },
  },
  auditor: {
    employee:         { actions: ["view"], scope: "all" },
    score:            { actions: ["view"], scope: "all" },
    scoring_config:   { actions: ["view"], scope: "all" },
    thread:           { actions: ["view"], scope: "all" },
    thread_note:      { actions: ["view"], scope: "all" },
    alert:            { actions: ["view"], scope: "all" },
    project:          { actions: ["view"], scope: "all" },
    incident:         { actions: ["view"], scope: "all" },
    travel_rule_case: { actions: ["view"], scope: "all" },
    daily_check:      { actions: ["view"], scope: "all" },
    staking_wallet:   { actions: ["view"], scope: "all" },
    settlement:       { actions: ["view"], scope: "all" },
    screening:        { actions: ["view"], scope: "all" },
    usdc_ramp:        { actions: ["view"], scope: "all" },
    token_review:     { actions: ["view"], scope: "all" },
    export:           { actions: ["view", "export"], scope: "all" },
    audit_log:        { actions: ["view"], scope: "all" },
    user:             { actions: ["view"], scope: "all" },
    branding:         { actions: ["view"], scope: "all" },
    transaction_confirmation: { actions: ["view"], scope: "all" },
    feature_flag:     { actions: ["view"], scope: "all" },
    session:          { actions: ["view"], scope: "all" },
    background_job:   { actions: ["view"], scope: "all" },
    report:           { actions: ["view", "export"], scope: "all" },
    metrics:          { actions: ["view"], scope: "all" },
  },
};

/** Sensitive fields that should be masked for non-admin roles */
export const SENSITIVE_FIELDS: Record<Resource, string[]> = {
  employee: ["email"],
  score: [],
  scoring_config: [],
  thread: ["participants"],
  thread_note: [],
  alert: [],
  project: [],
  incident: [],
  travel_rule_case: ["senderAddress", "receiverAddress", "emailSentTo"],
  daily_check: [],
  staking_wallet: ["walletAddress"],
  settlement: ["collateralWallet", "custodyWallet"],
  screening: [],
  usdc_ramp: ["bankReference", "ssiDetails", "custodyWalletId", "holdingWalletId"],
  token_review: [],
  export: [],
  audit_log: [],
  user: ["password"],
  branding: [],
  transaction_confirmation: ["emailSentTo", "slackChannel"],
  feature_flag: [],
  session: ["sessionToken", "ipAddress"],
  background_job: [],
  report: [],
  metrics: [],
};
