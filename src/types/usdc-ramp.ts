// ─── USDC On/Off Ramp Types ───

export type RampDirection = "onramp" | "offramp";
export type OnrampStatus =
  | "instruction_received"
  | "usd_received"
  | "usd_receipt_confirmed"
  | "usd_sent_to_issuer"
  | "usdc_minted"
  | "usdc_delivered"
  | "completed"
  | "rejected";
export type OfframpStatus =
  | "instruction_received"
  | "instruction_accepted"
  | "usdc_received"
  | "usd_conversion_pending"
  | "usd_sent"
  | "completed"
  | "rejected";
export type RampPriority = "low" | "normal" | "high" | "urgent";

export interface UsdcRampTicket {
  id: string;
  ticketRef: string;
  clientName: string;
  clientAccount: string;
  direction: RampDirection;
  amount: number;
  fiatCurrency: string;
  fiatAmount: number | null;
  status: string; // OnrampStatus | OfframpStatus
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
  checkerById: string | null;
  checkerByName: string | null;
  checkerAt: string | null;
  kycAmlOk: boolean;
  walletWhitelisted: boolean;
  evidence: string; // JSON array
  notes: string;
  rejectionReason: string;
  requestedAt: string;
  completedAt: string | null;
  clientNotifiedAt: string | null;
  priority: RampPriority;
  createdAt: string;
}

export interface UsdcRampOverview {
  tickets: UsdcRampTicket[];
  summary: {
    total: number;
    active: number;
    awaitingCheckerApproval: number;
    completed: number;
    feeBufferLow: boolean;
    totalOnrampVolume: number;
    totalOfframpVolume: number;
  };
}
