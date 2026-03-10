export interface JurisdictionGuidance {
  status: "approved" | "restricted" | "banned" | "under_review" | "unregulated" | "unknown";
  classification: string; // e.g. "Security", "Utility", "Payment Token", "e-Money"
  regulator: string; // e.g. "SEC", "FCA", "MAS"
  requirements: string[]; // key compliance requirements
  notes: string; // additional guidance
}

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
  // Token listing checklist fields
  jiraTicket: string;
  complianceDoc: string;
  launchDate: string;
  founders: string;
  website: string;
  supportedNetworks: string[];
  whitepaper: string;
  explorer: string;
  blockchainAnalytics: string;
  travelRuleNotabene: boolean;
  priceFeedCoingecko: boolean;
  consensusMechanism: string;
  privacyToken: boolean;
  jurisdictionStatus: Record<string, JurisdictionGuidance>;
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
  Cayman_Islands: "Cayman Islands (CIMA)",
  Bermuda: "Bermuda (BMA)",
  Australia: "Australia (ASIC)",
  Canada: "Canada (CSA/FINTRAC)",
};

export const BLOCKCHAIN_ANALYTICS_LABELS: Record<string, string> = {
  pre_growth: "Pre-Growth",
  emerging: "Emerging",
  mature: "Mature",
  unknown: "Unknown",
};

export const BLOCKCHAIN_ANALYTICS_COLORS: Record<string, string> = {
  pre_growth: "text-amber-400 bg-amber-500/10",
  emerging: "text-blue-400 bg-blue-500/10",
  mature: "text-emerald-400 bg-emerald-500/10",
  unknown: "text-muted-foreground bg-muted/30",
};

export const CONSENSUS_LABELS: Record<string, string> = {
  proof_of_work: "Proof of Work",
  proof_of_stake: "Proof of Stake",
  proof_of_authority: "Proof of Authority",
  proof_of_history: "Proof of History",
  other: "Other",
};

export const JURISDICTION_STATUS_COLORS: Record<string, string> = {
  approved: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  restricted: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  banned: "text-red-400 bg-red-500/10 border-red-500/20",
  under_review: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  unregulated: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  unknown: "text-muted-foreground bg-muted/30 border-border",
};

export const JURISDICTION_STATUS_LABELS: Record<string, string> = {
  approved: "Approved",
  restricted: "Restricted",
  banned: "Banned",
  under_review: "Under Review",
  unregulated: "Unregulated",
  unknown: "Unknown",
};

export const DEFAULT_JURISDICTION_GUIDANCE: Record<string, { regulator: string; defaultClassification: string; keyRequirements: string[] }> = {
  US: {
    regulator: "SEC / CFTC / FinCEN",
    defaultClassification: "Depends on Howey Test analysis",
    keyRequirements: [
      "Howey Test classification (security vs commodity)",
      "FinCEN MSB registration & BSA compliance",
      "OFAC sanctions screening",
      "State money transmitter licenses (if applicable)",
      "SAR/CTR filing obligations",
      "Privacy tokens face heightened scrutiny",
    ],
  },
  EU: {
    regulator: "ESMA / National CAs (MiCA)",
    defaultClassification: "Crypto-asset under MiCA",
    keyRequirements: [
      "MiCA classification: e-money token, asset-referenced token, or other crypto-asset",
      "White paper publication & notification to NCA",
      "CASP authorization required for service providers",
      "Travel Rule (TFR) compliance",
      "Market abuse prevention (MAR equivalent)",
      "Privacy tokens may conflict with traceability requirements",
    ],
  },
  UK: {
    regulator: "FCA",
    defaultClassification: "Cryptoasset (exchange/utility/security token)",
    keyRequirements: [
      "FCA registration for crypto businesses",
      "Financial promotions regime compliance",
      "AML/CTF compliance under MLR 2017",
      "Travel Rule (from Sept 2023)",
      "Consumer Duty obligations",
      "Security tokens require FCA authorization under RAO",
    ],
  },
  Switzerland: {
    regulator: "FINMA",
    defaultClassification: "Payment, utility, or asset token (FINMA guidelines)",
    keyRequirements: [
      "FINMA token classification (payment/utility/asset)",
      "AML compliance under AMLA",
      "DLT Trading Facility license (if exchange)",
      "SRO membership for financial intermediaries",
      "Travel Rule via FATF standards",
      "Asset tokens treated as securities",
    ],
  },
  Singapore: {
    regulator: "MAS",
    defaultClassification: "Digital Payment Token / Capital Markets Product",
    keyRequirements: [
      "Payment Services Act (PSA) licensing",
      "Securities and Futures Act if security token",
      "AML/CFT requirements under PSN02",
      "Travel Rule compliance",
      "Technology risk management guidelines",
      "Restricted retail access for certain products",
    ],
  },
  Japan: {
    regulator: "JFSA",
    defaultClassification: "Crypto Asset / Security Token",
    keyRequirements: [
      "JFSA registration as crypto-asset exchange",
      "PSA/FIEA classification",
      "Mandatory segregation of customer assets",
      "Travel Rule compliance (JFSA Notice)",
      "Whitelist system for listed tokens",
      "Privacy tokens delisted from registered exchanges",
    ],
  },
  UAE: {
    regulator: "VARA (Dubai) / FSRA (ADGM) / SCA",
    defaultClassification: "Virtual Asset",
    keyRequirements: [
      "VARA licensing for Dubai operations",
      "FSRA authorization for ADGM entities",
      "AML/CFT compliance under Federal AML law",
      "Travel Rule compliance",
      "Mandatory custody arrangements",
      "Technology governance framework",
    ],
  },
  Hong_Kong: {
    regulator: "SFC / HKMA",
    defaultClassification: "Virtual Asset",
    keyRequirements: [
      "SFC VASP licensing (from June 2023)",
      "Dual licensing for VA exchanges",
      "Professional investor restrictions (being relaxed)",
      "AML/CTF requirements under AMLO",
      "Travel Rule compliance",
      "Insurance/compensation requirements for custody",
    ],
  },
  Cayman_Islands: {
    regulator: "CIMA",
    defaultClassification: "Virtual Asset",
    keyRequirements: [
      "VASP registration under Virtual Asset Service Providers Act",
      "AML/CFT compliance under POCL/ATFL",
      "CIMA sandbox for novel products",
      "Travel Rule compliance",
      "Governance and risk management requirements",
    ],
  },
  Bermuda: {
    regulator: "BMA",
    defaultClassification: "Digital Asset",
    keyRequirements: [
      "Digital Asset Business Act (DABA) licensing",
      "Class F/M/T licensing categories",
      "AML/ATF compliance",
      "Cybersecurity requirements",
      "Prudential standards for custody",
      "Client disclosure obligations",
    ],
  },
  Australia: {
    regulator: "ASIC / AUSTRAC",
    defaultClassification: "Crypto-asset (financial product if meets definition)",
    keyRequirements: [
      "AUSTRAC registration for DCE providers",
      "AFSL if token is a financial product",
      "AML/CTF compliance",
      "Travel Rule (AUSTRAC guidance)",
      "Consumer protection under ASIC guidance",
      "Proposed licensing regime for crypto platforms",
    ],
  },
  Canada: {
    regulator: "CSA / FINTRAC / Provincial regulators",
    defaultClassification: "Crypto asset / Security",
    keyRequirements: [
      "MSB registration with FINTRAC",
      "Provincial securities registration if security",
      "CSA Staff Notice 21-327 compliance",
      "AML/ATF compliance",
      "Travel Rule compliance",
      "Restricted dealer or investment dealer registration",
    ],
  },
};
