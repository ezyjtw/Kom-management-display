import type { AlertSeverity, WorkItemKind } from "@prisma/client";
import type { DecimalValue } from "@/lib/decimal";

/** Spec §11.1: what an evaluator returns for each condition that currently holds. */
export interface AlertCandidate {
  dedupeKey: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  /** Link the alert to an existing WorkItem (e.g. an SLA breach on a client request). */
  workItemId?: string;
  /** Otherwise the engine creates an alert WorkItem from this seed. */
  workItemSeed?: { kind?: WorkItemKind; team?: string; taskCode?: string; clientId?: string | null; priority?: string };
  exposureUsd?: DecimalValue | null;
  priority?: string;
}

export interface EvaluatorContext {
  code: string;
  now: Date;
  params: Record<string, unknown>;
}

export type Evaluator = (ctx: EvaluatorContext) => Promise<AlertCandidate[]>;

export interface EscalationStep {
  afterMins: number;
  /** "lead" (owning team's lead), "admin", "oncall_primary", "oncall_secondary". */
  notifyRole: "lead" | "admin" | "oncall_primary" | "oncall_secondary";
}

export interface RuleDefinition {
  code: string;
  name: string;
  /** Owning team (Task Distribution / OnCallSchedule team name). */
  ownerTeam: string;
  severity: AlertSeverity;
  /** Human-readable default clock, shown in admin. */
  clock: string;
  /**
   * Default params. A `null` value is a CONFIRM placeholder: the rule cannot be
   * enabled until an admin sets it (spec §11.2). `confirm` names the CONFIRM id.
   */
  params: Record<string, unknown>;
  confirm?: Record<string, string>;
  /** Default Jira/JSM project for the alert ticket (spec §10.1). */
  ticketProject?: string;
  /** Auto-resolve after two clean runs (spec §11.1). False for "never" / "n/a" rules. */
  autoResolve: boolean;
  /** Evaluation cadence; default every run (60 s). */
  cadenceMins?: number;
  /** Medium-severity config rules go to the daily digest instead of notifying immediately. */
  digest?: boolean;
  /** Absent for rules raised by events or jobs (raiseAlert), not by the engine. */
  evaluate?: Evaluator;
  /** Called once when the engine opens a new alert for this rule. */
  onRaised?: (alertId: string, candidate: AlertCandidate) => Promise<void>;
}

/** Read a numeric param, falling back to a default. */
export function numParam(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function strListParam(params: Record<string, unknown>, key: string): string[] {
  const v = params[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
