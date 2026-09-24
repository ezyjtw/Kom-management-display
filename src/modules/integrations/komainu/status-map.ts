import { prisma } from "@/lib/prisma";
import { raiseAlert } from "@/modules/alerting/raise";

export type MappedSettlementStatus = "pending" | "in_progress" | "completed" | "failed" | "partial" | "unknown";
export type StatusEntity = "settlement" | "collateral_operation" | "portfolio";

/**
 * Map a raw settlement/operation/portfolio status through SettlementStatusMap
 * (CONFIRM-SETTLEMENT-STATUS). Unmapped values become "unknown" and raise
 * ALR-CFG-02 (unmapped status seen), once per open (entity, raw) pair.
 */
export async function mapStatuses(entity: StatusEntity, raws: Array<string | null | undefined>): Promise<Map<string, MappedSettlementStatus>> {
  const distinct = [...new Set(raws.filter((r): r is string => typeof r === "string" && r !== ""))];
  const rows = distinct.length
    ? await prisma.settlementStatusMap.findMany({ where: { entity, raw: { in: distinct } } })
    : [];
  const known = new Map(rows.map((r) => [r.raw, r.mapped as MappedSettlementStatus]));
  const out = new Map<string, MappedSettlementStatus>();
  for (const raw of distinct) {
    const mapped = known.get(raw);
    if (mapped) {
      out.set(raw, mapped);
    } else {
      out.set(raw, "unknown");
      await raiseAlert({
        ruleCode: "ALR-CFG-02",
        dedupeKey: `${entity}:${raw}`,
        message: `Unmapped ${entity.replace("_", " ")} status "${raw}" seen from the Komainu API. Add it to the status map.`,
        severity: "medium",
      });
    }
  }
  return out;
}
