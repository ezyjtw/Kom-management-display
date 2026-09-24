/**
 * Risk Signal source (spec §11.4, TODO(CONFIRM-RISK-SOURCE)). The custody API
 * has no risk score; risk levels come from Platform only. Nothing here infers risk
 * (H5): a signal is stored exactly as Platform reported it.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { raiseAlert } from "@/modules/alerting/raise";
import { londonParts } from "@/modules/alerting/calendar";
import { upsertSourceRecords } from "@/modules/integrations/source-records";

export type RiskLevel = "low" | "medium" | "high" | "requires_escalation";

export interface RiskSignal {
  requestId?: string;
  transactionId?: string;
  level: RiskLevel;
  rules: number[];
  reasons: string[];
  observedAt: Date;
  raw: string;
}

export interface RiskSignalSource {
  name: string;
  poll(since: Date): Promise<RiskSignal[]>;
}

/** A raw Platform post and its parse result (null = not understood). */
export type PlatformParser = (text: string, observedAt: Date) => RiskSignal | null;

/**
 * No parser ships until at least 10 redacted real samples are committed in
 * src/__tests__/fixtures/platform-risk/ (spec §11.4). Until then every message is
 * "unparsed", which raises an alert rather than being silently dropped.
 */
export const noParserYet: PlatformParser = () => null;

/** Parses Platform bot posts stored from the platform_notifications channel (SourceRecord slack/risk_signal_raw). */
export class SlackPlatformNotificationSource implements RiskSignalSource {
  name = "slack_platform_notifications";
  constructor(private readonly parse: PlatformParser = noParserYet) {}

  async poll(since: Date): Promise<RiskSignal[]> {
    const raws = await prisma.sourceRecord.findMany({
      where: { source: "slack", kind: "risk_signal_raw", firstSeenAt: { gte: since }, OR: [{ status: null }, { status: { not: "parsed" } }] },
      orderBy: { firstSeenAt: "asc" },
      take: 1000,
    });
    const out: RiskSignal[] = [];
    const unparsed: string[] = [];
    for (const r of raws) {
      const fields = (r.fields ?? {}) as Record<string, unknown>;
      const text = typeof fields.text === "string" ? fields.text : "";
      const signal = this.parse(text, r.occurredAt ?? r.firstSeenAt);
      if (signal) out.push(signal);
      else unparsed.push(r.externalId);
      await prisma.sourceRecord.update({ where: { id: r.id }, data: { status: signal ? "parsed" : "unparsed" } });
    }
    if (unparsed.length) {
      // Failing safe (spec §11.4): an unparsed risk notification is an alert, never silence.
      const day = londonParts(new Date()).date;
      await raiseAlert({
        ruleCode: "ALR-CFG-02",
        dedupeKey: `risk_notification:${day}`,
        message: `Unparsed Platform risk notification(s): ${unparsed.length} message(s) in the platform_notifications channel could not be read. Check them in Platform directly.`,
        severity: "medium",
      });
    }
    return out;
  }
}

/** Pending Engineering: may be a database view or an internal endpoint. */
export class PlatformInternalFeedSource implements RiskSignalSource {
  name = "platform_internal_feed";
  async poll(): Promise<RiskSignal[]> {
    // TODO(CONFIRM-RISK-SOURCE): implement once Engineering provides the feed.
    return [];
  }
}

export function signalKey(s: RiskSignal): string {
  return `${s.requestId ?? "-"}:${s.transactionId ?? "-"}:${s.observedAt.toISOString()}`;
}

/** Store signals as SourceRecord platform/risk_signal for the RSK rules. */
export async function storeSignals(source: string, signals: RiskSignal[]): Promise<void> {
  await upsertSourceRecords("platform", "risk_signal", signals.map((s) => ({
    externalId: signalKey(s),
    status: s.level,
    occurredAt: s.observedAt,
    fields: {
      source,
      requestId: s.requestId ?? null,
      transactionId: s.transactionId ?? null,
      level: s.level,
      rules: s.rules,
      reasons: s.reasons,
    },
  })));
}

/** Job `poll_risk_signals`. */
export async function pollRiskSignals(sources: RiskSignalSource[] = [new SlackPlatformNotificationSource(), new PlatformInternalFeedSource()], now = new Date()) {
  const since = new Date(now.getTime() - 24 * 3_600_000);
  let total = 0;
  for (const src of sources) {
    try {
      const signals = await src.poll(since);
      await storeSignals(src.name, signals);
      total += signals.length;
    } catch (error) {
      logger.error("Risk signal source failed", { source: src.name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { signals: total };
}
