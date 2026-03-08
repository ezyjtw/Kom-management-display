"use client";

import {
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  CheckCircle2,
  XCircle,
  Shield,
  ShieldCheck,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  FileCheck,
  Wallet,
  User,
  AlertCircle,
} from "lucide-react";

interface RampTicket {
  id: string;
  ticketRef: string;
  clientName: string;
  clientAccount: string;
  direction: string;
  amount: number;
  fiatCurrency: string;
  fiatAmount: number | null;
  status: string;
  bankReference: string;
  instructionRef: string;
  ssiVerified: boolean;
  ssiDetails: string;
  custodyWalletId: string;
  holdingWalletId: string;
  onChainTxHash: string;
  gasWalletOk: boolean;
  issuerConfirmation: string;
  expressEnabled: boolean;
  feesFromBuffer: boolean;
  feeBufferLow: boolean;
  makerById: string | null;
  makerByName: string | null;
  makerAt: string | null;
  makerNote: string;
  checkerById: string | null;
  checkerByName: string | null;
  checkerAt: string | null;
  checkerNote: string;
  kycAmlOk: boolean;
  walletWhitelisted: boolean;
  evidence: string;
  notes: string;
  rejectionReason: string;
  requestedAt: string;
  completedAt: string | null;
  clientNotifiedAt: string | null;
  priority: string;
  createdAt: string;
}

const ONRAMP_STAGES = [
  { key: "instruction_received", label: "Instruction Received", short: "Received" },
  { key: "usd_received", label: "USD Received — Pending Conversion", short: "USD Recv" },
  { key: "usd_receipt_confirmed", label: "USD Receipt Confirmed", short: "Confirmed" },
  { key: "usd_sent_to_issuer", label: "USD Sent to Issuer", short: "Sent" },
  { key: "usdc_minted", label: "USDC Minted to Holding Wallet", short: "Minted" },
  { key: "usdc_delivered", label: "USDC Delivered to Client Wallet", short: "Delivered" },
  { key: "completed", label: "Completed", short: "Done" },
];

const OFFRAMP_STAGES = [
  { key: "instruction_received", label: "Instruction Received", short: "Received" },
  { key: "instruction_accepted", label: "Instruction Accepted", short: "Accepted" },
  { key: "usdc_received", label: "USDC Received at Issuer", short: "USDC Recv" },
  { key: "usd_conversion_pending", label: "USD Conversion Pending", short: "Converting" },
  { key: "usd_sent", label: "USD Sent to Client Bank", short: "USD Sent" },
  { key: "completed", label: "Completed", short: "Done" },
];

function getStages(direction: string) { return direction === "onramp" ? ONRAMP_STAGES : OFFRAMP_STAGES; }
function getStageIndex(direction: string, status: string): number { const idx = getStages(direction).findIndex((s) => s.key === status); return idx >= 0 ? idx : 0; }
function getNextStatus(direction: string, currentStatus: string): string | null { const stages = getStages(direction); const idx = stages.findIndex((s) => s.key === currentStatus); return idx < 0 || idx >= stages.length - 1 ? null : stages[idx + 1].key; }
function formatUsd(val: number) { return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const PRIORITY_COLORS: Record<string, string> = { low: "text-muted-foreground", normal: "text-foreground", high: "text-amber-400", urgent: "text-red-400 font-semibold" };

interface TicketRowProps {
  ticket: RampTicket;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onPatch: (id: string, body: Record<string, unknown>) => void;
}

export function TicketRow({ ticket: t, isExpanded, onToggleExpand, onPatch }: TicketRowProps) {
  const stages = getStages(t.direction);
  const stageIdx = getStageIndex(t.direction, t.status);
  const nextStatus = getNextStatus(t.direction, t.status);
  const isActive = t.status !== "completed" && t.status !== "rejected";

  return (
    <div className={`bg-card rounded-xl border transition-colors ${t.feeBufferLow ? "border-amber-500/40" : "border-border"} ${isActive ? "hover:border-primary/30" : ""}`}>
      <div className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {t.direction === "onramp" ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-500/10 text-emerald-400"><ArrowDownRight size={12} /> Onramp</span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-500/10 text-blue-400"><ArrowUpRight size={12} /> Offramp</span>
              )}
              <span className="text-xs font-mono text-muted-foreground">{t.ticketRef.slice(0, 12)}</span>
              {t.priority !== "normal" && <span className={`text-xs ${PRIORITY_COLORS[t.priority]}`}>{t.priority.toUpperCase()}</span>}
              {t.status === "rejected" && <span className="px-2 py-0.5 rounded-full text-xs bg-red-500/10 text-red-400">Rejected</span>}
            </div>
            <h3 className="text-sm font-semibold text-foreground mt-1.5">{t.clientName}</h3>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
              <span className="font-mono text-foreground text-sm font-semibold">{formatUsd(t.amount)} USDC</span>
              {t.fiatAmount && <span>≈ {t.fiatCurrency} {formatUsd(t.fiatAmount)}</span>}
              {t.bankReference && <span>SWIFT: {t.bankReference}</span>}
              {t.instructionRef && <span>Instr: {t.instructionRef}</span>}
            </div>
            {isActive && (
              <>
                <div className="mt-3 flex items-center gap-1">
                  {stages.map((stage, i) => (
                    <div key={stage.key} className="flex items-center gap-1 flex-1">
                      <div className={`h-1.5 flex-1 rounded-full ${i <= stageIdx ? "bg-primary" : "bg-muted/50"}`} />
                      {i < stages.length - 1 && <div className="w-0.5" />}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-primary mt-1">{stages[stageIdx]?.label || t.status}</p>
              </>
            )}
          </div>

          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <div className="flex items-center gap-1 text-xs text-muted-foreground"><Clock size={12} />{new Date(t.requestedAt).toLocaleDateString()}</div>
            <div className="flex items-center gap-2">
              {t.makerById ? <span className="inline-flex items-center gap-1 text-xs text-emerald-400"><ShieldCheck size={12} /> Maker: {t.makerByName || "Done"}</span>
                : isActive ? <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Shield size={12} /> No maker</span> : null}
              {t.checkerById ? <span className="inline-flex items-center gap-1 text-xs text-emerald-400"><ShieldCheck size={12} /> Checker: {t.checkerByName || "Done"}</span>
                : t.makerById && isActive ? <span className="inline-flex items-center gap-1 text-xs text-amber-400"><Shield size={12} /> Awaiting checker</span> : null}
            </div>
            {t.completedAt && <p className="text-xs text-emerald-400">Done {new Date(t.completedAt).toLocaleDateString()}</p>}
            {t.onChainTxHash && <p className="text-xs text-emerald-400 font-mono flex items-center gap-1"><ExternalLink size={10} /> {t.onChainTxHash.slice(0, 16)}...</p>}
            {isActive && (
              <div className="flex items-center gap-1 mt-1">
                {!t.makerById && <button onClick={() => onPatch(t.id, { action: "maker_confirm", status: nextStatus })} className="px-2 py-1 text-xs border border-border rounded hover:bg-emerald-500/10 text-emerald-400">Maker Confirm</button>}
                {t.makerById && !t.checkerById && <button onClick={() => onPatch(t.id, { action: "checker_approve", status: nextStatus })} className="px-2 py-1 text-xs border border-border rounded hover:bg-purple-500/10 text-purple-400">Checker Approve</button>}
                {nextStatus && t.checkerById && <button onClick={() => onPatch(t.id, { action: "advance_status", status: nextStatus })} className="px-2 py-1 text-xs border border-border rounded hover:bg-blue-500/10 text-blue-400">Advance →</button>}
                <button onClick={() => onPatch(t.id, { action: "reject", rejectionReason: "Manual rejection" })} className="p-1 rounded hover:bg-red-500/10 text-red-400"><XCircle size={14} /></button>
              </div>
            )}
            <button onClick={onToggleExpand} className="p-1 rounded hover:bg-accent/50 text-muted-foreground mt-1">
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-border px-4 py-3 bg-muted/10">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
            <div>
              <p className="font-semibold text-foreground mb-1.5 flex items-center gap-1"><FileCheck size={12} /> Pre-flight Checks</p>
              <div className="space-y-1">
                {[
                  { label: "KYC/AML OK", ok: t.kycAmlOk, field: "kycAmlOk" },
                  { label: "SSI Verified", ok: t.ssiVerified, field: "ssiVerified" },
                  { label: "Wallet Whitelisted", ok: t.walletWhitelisted, field: "walletWhitelisted" },
                  { label: "Gas Wallet OK", ok: t.gasWalletOk, field: "gasWalletOk" },
                  { label: "Express Enabled", ok: t.expressEnabled, field: "expressEnabled" },
                ].map((check) => (
                  <button key={check.field} onClick={() => onPatch(t.id, { action: "update_checks", [check.field]: !check.ok })}
                    className="flex items-center gap-2 w-full text-left hover:bg-accent/30 rounded px-1 py-0.5">
                    {check.ok ? <CheckCircle2 size={12} className="text-emerald-400 shrink-0" /> : <XCircle size={12} className="text-red-400 shrink-0" />}
                    <span className={check.ok ? "text-foreground" : "text-muted-foreground"}>{check.label}</span>
                  </button>
                ))}
              </div>
              {t.feeBufferLow && <div className="flex items-center gap-1 mt-2 text-amber-400"><AlertCircle size={12} /><span>Fee buffer low — needs top-up</span></div>}
              {!t.feeBufferLow && isActive && <button onClick={() => onPatch(t.id, { action: "flag_buffer" })} className="mt-2 text-muted-foreground hover:text-amber-400">Flag fee buffer low</button>}
            </div>
            <div>
              <p className="font-semibold text-foreground mb-1.5 flex items-center gap-1"><Wallet size={12} /> Wallets & Chain</p>
              <div className="space-y-1 text-muted-foreground">
                {t.custodyWalletId && <p>Custody Wallet: <span className="font-mono text-foreground">{t.custodyWalletId}</span></p>}
                {t.holdingWalletId && <p>Holding Wallet: <span className="font-mono text-foreground">{t.holdingWalletId}</span></p>}
                {t.onChainTxHash && <p>TX Hash: <span className="font-mono text-foreground">{t.onChainTxHash}</span></p>}
                {t.issuerConfirmation && <p>Issuer Conf: <span className="text-foreground">{t.issuerConfirmation}</span></p>}
                {t.ssiDetails && <p>SSI: <span className="text-foreground">{t.ssiDetails}</span></p>}
              </div>
            </div>
            <div>
              <p className="font-semibold text-foreground mb-1.5 flex items-center gap-1"><User size={12} /> Audit Trail</p>
              <div className="space-y-1 text-muted-foreground">
                <p>Requested: {new Date(t.requestedAt).toLocaleString()}</p>
                {t.makerById && <p>Maker: {t.makerByName} @ {t.makerAt ? new Date(t.makerAt).toLocaleString() : "—"}</p>}
                {t.makerNote && <p className="italic">&quot;{t.makerNote}&quot;</p>}
                {t.checkerById && <p>Checker: {t.checkerByName} @ {t.checkerAt ? new Date(t.checkerAt).toLocaleString() : "—"}</p>}
                {t.checkerNote && <p className="italic">&quot;{t.checkerNote}&quot;</p>}
                {t.clientNotifiedAt && <p>Client Notified: {new Date(t.clientNotifiedAt).toLocaleString()}</p>}
                {t.completedAt && <p className="text-emerald-400">Completed: {new Date(t.completedAt).toLocaleString()}</p>}
              </div>
              {t.notes && <p className="mt-1 italic text-muted-foreground">{t.notes}</p>}
              {t.rejectionReason && <p className="mt-1 text-red-400">Rejected: {t.rejectionReason}</p>}
              {isActive && !t.clientNotifiedAt && t.status === "completed" && (
                <button onClick={() => onPatch(t.id, { action: "notify_client" })} className="mt-2 px-2 py-1 text-xs border border-border rounded hover:bg-emerald-500/10 text-emerald-400">Mark Client Notified</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
