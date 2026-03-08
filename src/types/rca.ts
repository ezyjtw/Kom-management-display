// ─── RCA Tracker Types ───

export type RcaStatus = "none" | "raised" | "awaiting_rca" | "rca_received" | "follow_up_pending" | "closed";

export interface RcaFollowUpItem {
  title: string;
  status: "pending" | "done";
  assigneeId?: string;
}

export interface RcaIncidentEntry {
  id: string;
  title: string;
  provider: string;
  severity: string;
  status: string;
  rcaStatus: RcaStatus;
  rcaDocumentRef: string;
  rcaResponsibleId: string | null;
  rcaResponsibleName: string | null;
  rcaSlaDeadline: string | null;
  rcaReceivedAt: string | null;
  rcaRaisedAt: string | null;
  rcaFollowUpItems: RcaFollowUpItem[];
  ageDays: number;
  slaOverdue: boolean;
  startedAt: string;
  createdAt: string;
}

export interface RcaOverview {
  incidents: RcaIncidentEntry[];
  summary: {
    total: number;
    awaiting: number;
    overdue: number;
    followUp: number;
    closed: number;
  };
}
