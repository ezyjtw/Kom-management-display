/**
 * Alerting engine (spec §11.1). Rules are TypeScript evaluators registered by
 * code in the catalogue, with parameters from AlertRule.params. For each
 * candidate the engine:
 *   1. upserts the open alert by (ruleCode, dedupeKey);
 *   2. creates or updates the WorkItem and ticket (spec §10.1);
 *   3. routes the notification (spec §11.3);
 *   4. schedules escalation (runEscalations walks the ladder);
 *   5. auto-resolves when the candidate is missing for two consecutive runs,
 *      commenting "condition cleared at <time>" on the ticket. The ticket is
 *      never closed: closure still needs the write-up.
 * Runs from the worker (job `evaluate_alerts`, every minute); rules may
 * declare their own cadence. Rules ship disabled.
 */

import { Prisma, type Alert, type AlertRule, type AlertSeverity } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { ensureAlertTicket } from "@/modules/work-items/tickets";
import { commentInternal } from "@/modules/work-items/ticket-writeback";
import { maybeCreateIncidentLogDraftForAlert } from "@/modules/incident-log/drafts";
import { effectiveParams, missingConfirmParams, RULE_CATALOGUE } from "@/modules/alerting/catalogue";
import { notifyAlert, runEscalations } from "@/modules/alerting/routing";
import type { AlertCandidate, RuleDefinition } from "@/modules/alerting/types";

export const CLEAN_RUNS_TO_RESOLVE = 2;
const SEVERITY_ORDER: AlertSeverity[] = ["low", "medium", "high", "critical"];
const higher = (a: AlertSeverity, b: AlertSeverity) => (SEVERITY_ORDER.indexOf(b) > SEVERITY_ORDER.indexOf(a) ? b : a);

/** Insert catalogue rules that are missing from AlertRule, disabled. Existing rows are never changed. */
export async function syncRuleCatalogue(): Promise<number> {
  const existing = new Set((await prisma.alertRule.findMany({ select: { code: true } })).map((r) => r.code));
  let created = 0;
  for (const def of Object.values(RULE_CATALOGUE)) {
    if (existing.has(def.code)) continue;
    await prisma.alertRule.create({
      data: {
        code: def.code,
        enabled: false,
        severity: def.severity,
        params: def.params as Prisma.InputJsonValue,
        route: { businessHours: [], outOfHours: [], ...(def.ticketProject ? { ticketProject: def.ticketProject } : {}) } as Prisma.InputJsonValue,
      },
    }).then(() => created++).catch((error) => {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    });
  }
  return created;
}

export interface ApplyResult {
  raised: string[];
  refired: string[];
  resolved: string[];
}

async function openAlert(rule: AlertRule, def: RuleDefinition, c: AlertCandidate, now: Date): Promise<string> {
  try {
    const alert = await prisma.alert.create({
      data: {
        type: rule.code,
        ruleCode: rule.code,
        dedupeKey: c.dedupeKey,
        message: c.title.slice(0, 500),
        detail: c.detail.slice(0, 4000),
        severity: c.severity,
        priority: c.priority ?? (c.severity === "critical" ? "P1" : "P2"),
        exposureUsd: c.exposureUsd ?? null,
        workItemId: c.workItemId ?? null,
        firstFiredAt: now,
        lastFiredAt: now,
      },
    });
    return alert.id;
  } catch (error) {
    // Lost a race: the partial unique index keeps one open alert per (ruleCode, dedupeKey).
    const again = await prisma.alert.findFirst({ where: { ruleCode: rule.code, dedupeKey: c.dedupeKey, status: { not: "resolved" } } });
    if (again) return again.id;
    throw error;
  }
}

/** Apply one run's candidates for a rule. */
export async function applyCandidates(rule: AlertRule, def: RuleDefinition, candidates: AlertCandidate[], now: Date): Promise<ApplyResult> {
  const result: ApplyResult = { raised: [], refired: [], resolved: [] };
  const open = await prisma.alert.findMany({ where: { ruleCode: rule.code, status: { not: "resolved" } } });
  const byKey = new Map(open.map((a) => [a.dedupeKey, a]));
  const seen = new Set<string>();

  for (const c of candidates) {
    if (seen.has(c.dedupeKey)) continue;
    seen.add(c.dedupeKey);
    const existing = byKey.get(c.dedupeKey);

    if (existing) {
      const reappeared = existing.cleanRuns > 0;
      await prisma.alert.update({
        where: { id: existing.id },
        data: {
          lastFiredAt: now,
          cleanRuns: 0,
          severity: higher(existing.severity, c.severity),
          detail: c.detail.slice(0, 4000),
          ...(c.exposureUsd !== undefined ? { exposureUsd: c.exposureUsd } : {}),
          ...(reappeared ? { fireCount: { increment: 1 } } : {}),
        },
      });
      if (reappeared || SEVERITY_ORDER.indexOf(c.severity) > SEVERITY_ORDER.indexOf(existing.severity)) {
        await ensureAlertTicket(existing.id, { repeat: true });
        await safe("notify", () => notifyAlert(existing.id, now));
        result.refired.push(existing.id);
      }
      continue;
    }

    const id = await openAlert(rule, def, c, now);
    await ensureAlertTicket(id, { repeat: false, seed: c.workItemSeed });
    await safe("incidentLog", () => maybeCreateIncidentLogDraftForAlert(id));
    if (def.onRaised) await safe("onRaised", () => def.onRaised!(id, c));
    await safe("notify", () => notifyAlert(id, now));
    result.raised.push(id);
  }

  if (def.autoResolve) {
    for (const a of open) {
      if (seen.has(a.dedupeKey)) continue;
      const cleanRuns = a.cleanRuns + 1;
      if (cleanRuns < CLEAN_RUNS_TO_RESOLVE) {
        await prisma.alert.update({ where: { id: a.id }, data: { cleanRuns } });
        continue;
      }
      await autoResolve(a, now);
      result.resolved.push(a.id);
    }
  }
  return result;
}

async function autoResolve(a: Alert, now: Date): Promise<void> {
  await prisma.alert.update({ where: { id: a.id }, data: { cleanRuns: CLEAN_RUNS_TO_RESOLVE, status: "resolved", resolvedAt: now, autoResolvedAt: now } });
  if (!a.workItemId) return;
  const item = await prisma.workItem.findUnique({ where: { id: a.workItemId }, select: { ticketKey: true } });
  if (item?.ticketKey) {
    await safe("comment", () => commentInternal(a.workItemId!, `${a.ruleCode}: condition cleared at ${now.toISOString()}. The ticket stays open until it is closed with a write-up.`));
  }
}

async function safe<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    logger.warn(`Alert engine: ${what} failed`, { error: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

export interface EngineRunSummary {
  evaluated: string[];
  skipped: Array<{ code: string; reason: string }>;
  raised: number;
  refired: number;
  resolved: number;
  escalated: number;
}

/** Job `evaluate_alerts`. */
export async function runAlertEngine(now = new Date()): Promise<EngineRunSummary> {
  await syncRuleCatalogue();
  const summary: EngineRunSummary = { evaluated: [], skipped: [], raised: 0, refired: 0, resolved: 0, escalated: 0 };
  const rules = await prisma.alertRule.findMany({ where: { enabled: true } });
  const run = new Map<string, unknown>(); // per-run memo shared by the evaluators

  for (const rule of rules) {
    const def = RULE_CATALOGUE[rule.code];
    if (!def?.evaluate) continue;
    if (def.cadenceMins && rule.lastEvaluatedAt && now.getTime() - rule.lastEvaluatedAt.getTime() < def.cadenceMins * 60_000 - 5_000) continue;
    const missing = missingConfirmParams(rule.code, rule.params);
    if (missing.length) {
      summary.skipped.push({ code: rule.code, reason: `missing ${missing.join(", ")}` });
      continue;
    }

    let candidates: AlertCandidate[];
    try {
      candidates = await def.evaluate({ code: rule.code, now, params: effectiveParams(rule.code, rule.params), run });
    } catch (error) {
      // An evaluator error is not a clean run: never auto-resolve on failure.
      logger.error("Alert evaluator failed", { code: rule.code, error: error instanceof Error ? error.message : String(error) });
      summary.skipped.push({ code: rule.code, reason: "evaluator error" });
      continue;
    }
    const r = await applyCandidates(rule, def, candidates, now);
    await prisma.alertRule.update({ where: { code: rule.code }, data: { lastEvaluatedAt: now } });
    summary.evaluated.push(rule.code);
    summary.raised += r.raised.length;
    summary.refired += r.refired.length;
    summary.resolved += r.resolved.length;
  }

  summary.escalated = (await runEscalations(now)).escalated;
  return summary;
}
