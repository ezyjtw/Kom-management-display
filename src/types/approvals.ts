// ─── Approvals Queue Types ───

export type ApprovalRiskLevel = "low" | "medium" | "high";
export type ApprovalLane = "auto_approve" | "ops_approval" | "compliance_review";

export interface ApprovalQueueItem {
  id: string;
  type: string;
  status: string;
  entity: string;
  requestedBy: string;
  requestedAt: string;
  expiresAt: string;
  workspace: string;
  organization: string;
  account: string;
  ageMinutes: number;
  riskLevel: ApprovalRiskLevel;
  lane: ApprovalLane;
}

export interface ApprovalQueueOverview {
  items: ApprovalQueueItem[];
  summary: {
    total: number;
    autoApprove: number;
    opsApproval: number;
    complianceReview: number;
  };
  configured: boolean;
}
