// ─── OES Settlement Types ───

export type OesVenue = "okx" | "fireblocks";
export type SettlementMatchStatus = "pending" | "matched" | "mismatch" | "missing_tx" | "flagged";
export type SettlementStatus = "pending" | "confirmed" | "completed" | "escalated" | "failed";
export type DelegationStatus = "n/a" | "delegated" | "undelegated" | "pending_delegation";

export interface OesSettlementEntry {
  id: string;
  settlementRef: string;
  venue: OesVenue;
  clientName: string;
  clientAccount: string;
  asset: string;
  amount: number;
  direction: string; // custody_to_exchange | exchange_to_custody
  settlementCycle: string;
  exchangeInstructionId: string;
  onChainTxHash: string;
  collateralWallet: string;
  custodyWallet: string;
  matchStatus: SettlementMatchStatus;
  matchNote: string;
  delegationStatus: DelegationStatus;
  delegatedAmount: number;
  status: SettlementStatus;
  makerById: string | null;
  makerByName: string | null;
  makerAt: string | null;
  checkerById: string | null;
  checkerByName: string | null;
  checkerAt: string | null;
  escalationNote: string;
  fireblockssTxId: string;
  oesSignerGroup: string;
  createdAt: string;
}

export interface OesSettlementOverview {
  settlements: OesSettlementEntry[];
  summary: {
    total: number;
    pending: number;
    confirmed: number;
    completed: number;
    escalated: number;
    failed: number;
    matched: number;
    mismatched: number;
    missingTx: number;
    flagged: number;
    byVenue: { okx: number; fireblocks: number };
  };
}
