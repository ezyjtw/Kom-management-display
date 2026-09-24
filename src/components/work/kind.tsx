import {
  AlertTriangle, BadgeAlert, Bell, Building2, ClipboardCheck, Coins, FileText, Gavel, Landmark, LifeBuoy, MessageSquare,
  Scale, ScanSearch, ShieldAlert, Sparkles, Split, Truck, Wrench, type LucideIcon,
} from "lucide-react";

export const KIND_META: Record<string, { label: string; icon: LucideIcon }> = {
  client_request: { label: "Client request", icon: MessageSquare },
  client_incident: { label: "Client incident", icon: BadgeAlert },
  client_risk: { label: "Client risk", icon: ShieldAlert },
  alert: { label: "Alert", icon: Bell },
  daily_check_exception: { label: "Check exception", icon: ClipboardCheck },
  mtd_break: { label: "MTD break", icon: Split },
  oes_settlement: { label: "OES settlement", icon: Landmark },
  bank_instruction: { label: "BANK instruction", icon: Building2 },
  realisation_case: { label: "RLS case", icon: Scale },
  vendor_ticket: { label: "Vendor ticket", icon: Truck },
  travel_rule_case: { label: "Travel rule", icon: FileText },
  screening_case: { label: "Screening", icon: ScanSearch },
  scam_dust_case: { label: "Scam dust", icon: AlertTriangle },
  coin_review: { label: "Coin review", icon: Coins },
  staking_exception: { label: "Staking", icon: Sparkles },
  nft_review: { label: "NFT review", icon: Sparkles },
  report_task: { label: "Report", icon: FileText },
  incident: { label: "Incident", icon: LifeBuoy },
  rca: { label: "RCA", icon: Gavel },
  internal_task: { label: "Internal task", icon: Wrench },
};

export function KindIcon({ kind }: { kind: string }) {
  const meta = KIND_META[kind] ?? { label: kind, icon: FileText };
  const Icon = meta.icon;
  return <Icon size={14} aria-label={meta.label} className="text-muted-foreground shrink-0" />;
}
