export interface DemandSignal {
  id: string;
  signalType: string;
  source: string;
  description: string;
  weight: number;
  createdAt: string;
}

export interface TokenEntry {
  id: string;
  symbol: string;
  name: string;
  network: string;
  contractAddress: string;
  tokenType: string;
  status: string;
  proposedById: string | null;
  proposedAt: string;
  reviewedAt: string | null;
  complianceAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  liveAt: string | null;
  rejectionReason: string;
  riskLevel: string;
  riskNotes: string;
  regulatoryNotes: string;
  sanctionsCheck: boolean;
  amlRiskAssessed: boolean;
  custodianSupport: string[];
  stakingAvailable: boolean;
  chainalysisSupport: string;
  notabeneSupport: string;
  fireblocksSupport: string;
  ledgerSupport: string;
  vendorNotes: Record<string, string>;
  aiResearchResult: Record<string, unknown> | null;
  aiResearchedAt: string | null;
  aiRecommendation: string;
  demandScore: number;
  demandSignals: DemandSignal[];
  marketCapTier: string;
  notes: string;
  createdAt: string;
}

export interface TokenSummary {
  total: number;
  proposed: number;
  underReview: number;
  complianceReview: number;
  approved: number;
  rejected: number;
  live: number;
  highRisk: number;
}

export interface TokenData {
  tokens: TokenEntry[];
  summary: TokenSummary;
}

export interface TokenSuggestion {
  symbol: string;
  name: string;
  network: string;
  tokenType: string;
  marketCapTier: string;
  rationale: string;
  urgency: string;
  suggestedRiskLevel: string;
  chains: string[];
}

export type Tab = "pipeline" | "live" | "demand" | "discover";

export const STATUS_FLOW = ["proposed", "under_review", "compliance_review", "approved", "live"];

export const SIGNAL_TYPE_LABELS: Record<string, string> = {
  client_request: "Client Request",
  market_trend: "Market Trend",
  competitor_listed: "Competitor Listed",
  internal_proposal: "Internal Proposal",
};

export const MARKET_CAP_LABELS: Record<string, string> = {
  mega: "Mega Cap",
  large: "Large Cap",
  mid: "Mid Cap",
  small: "Small Cap",
  micro: "Micro Cap",
  unknown: "Unknown",
};

export const VENDOR_STATUS_COLORS: Record<string, string> = {
  supported: "text-emerald-400 bg-emerald-500/10",
  partial: "text-amber-400 bg-amber-500/10",
  not_supported: "text-red-400 bg-red-500/10",
  unknown: "text-muted-foreground bg-muted/30",
};

export const VENDOR_STATUS_LABELS: Record<string, string> = {
  supported: "Supported",
  partial: "Partial",
  not_supported: "Not Supported",
  unknown: "Unknown",
};

export const JURISDICTION_LABELS: Record<string, string> = {
  US: "US (SEC/CFTC)",
  EU: "EU (MiCA)",
  UK: "UK (FCA)",
  Switzerland: "Switzerland (FINMA)",
  Singapore: "Singapore (MAS)",
  Japan: "Japan (JFSA)",
  UAE: "UAE (VARA/ADGM)",
  Hong_Kong: "Hong Kong (SFC)",
};
