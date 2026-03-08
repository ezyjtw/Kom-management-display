// ─── Screening & Scam/Dust Types ───

export type ScreeningStatus = "submitted" | "processing" | "completed" | "not_submitted" | "exception";
export type ScreeningClassification = "unclassified" | "legitimate" | "dust" | "scam";
export type AnalyticsAlertStatus = "none" | "open" | "under_review" | "resolved";
export type ComplianceReviewStatus = "none" | "pending" | "approved" | "rejected";

export interface ScreeningEntryData {
  id: string;
  transactionId: string;
  txHash: string;
  asset: string;
  amount: number;
  direction: string;
  screeningStatus: ScreeningStatus;
  classification: ScreeningClassification;
  isKnownException: boolean;
  exceptionReason: string;
  analyticsAlertId: string;
  analyticsStatus: AnalyticsAlertStatus;
  complianceReviewStatus: ComplianceReviewStatus;
  reclassifiedAt: string | null;
  notes: string;
  createdAt: string;
}

export interface ScreeningOverview {
  entries: ScreeningEntryData[];
  summary: {
    total: number;
    submitted: number;
    processing: number;
    notSubmitted: number;
    dust: number;
    scam: number;
    openAlerts: number;
  };
}
