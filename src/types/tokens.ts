// ─── Token Review Types ───

export type TokenReviewStatus = "proposed" | "under_review" | "compliance_review" | "approved" | "rejected" | "live";
export type TokenRiskLevel = "low" | "medium" | "high" | "critical";
export type MarketCapTier = "mega" | "large" | "mid" | "small" | "micro" | "unknown";
export type TokenType = "native" | "erc20" | "spl" | "substrate" | "other";
export type DemandSignalType = "client_request" | "market_trend" | "competitor_listed" | "internal_proposal";
export type VendorSupportStatus = "supported" | "partial" | "not_supported" | "unknown";

export interface TokenDemandSignalEntry {
  id: string;
  signalType: DemandSignalType;
  source: string;
  description: string;
  weight: number;
  recordedById: string | null;
  createdAt: string;
}

export interface TokenReviewEntry {
  id: string;
  symbol: string;
  name: string;
  network: string;
  contractAddress: string;
  tokenType: TokenType;
  status: TokenReviewStatus;
  proposedById: string | null;
  proposedByName: string | null;
  proposedAt: string;
  reviewedById: string | null;
  reviewedAt: string | null;
  complianceById: string | null;
  complianceAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  liveAt: string | null;
  rejectionReason: string;
  riskLevel: TokenRiskLevel;
  riskNotes: string;
  regulatoryNotes: string;
  sanctionsCheck: boolean;
  amlRiskAssessed: boolean;
  custodianSupport: string[];
  stakingAvailable: boolean;
  // Third-party vendor support
  chainalysisSupport: VendorSupportStatus;
  notabeneSupport: VendorSupportStatus;
  fireblocksSupport: VendorSupportStatus;
  ledgerSupport: VendorSupportStatus;
  vendorNotes: Record<string, string>;
  // AI research persistence
  aiResearchResult: Record<string, unknown> | null;
  aiResearchedAt: string | null;
  aiRecommendation: string;
  // Other
  demandScore: number;
  demandSignals: TokenDemandSignalEntry[];
  marketCapTier: MarketCapTier;
  notes: string;
  createdAt: string;
}

export interface TokenSuggestion {
  symbol: string;
  name: string;
  network: string;
  tokenType: string;
  marketCapTier: string;
  rationale: string;
  urgency: "high" | "medium" | "low";
  suggestedRiskLevel: string;
  chains: string[];
}

export interface TokenReviewOverview {
  tokens: TokenReviewEntry[];
  summary: {
    total: number;
    proposed: number;
    underReview: number;
    complianceReview: number;
    approved: number;
    rejected: number;
    live: number;
    highRisk: number;
  };
}
