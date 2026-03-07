"use client";

const statusStyles: Record<string, string> = {
  Unassigned: "bg-muted text-muted-foreground",
  Assigned: "bg-blue-500/10 text-blue-400",
  InProgress: "bg-indigo-500/10 text-indigo-400",
  WaitingExternal: "bg-amber-500/10 text-amber-400",
  WaitingInternal: "bg-orange-500/10 text-orange-400",
  Done: "bg-emerald-500/10 text-emerald-400",
  Closed: "bg-muted text-muted-foreground",
};

const statusLabels: Record<string, string> = {
  Unassigned: "Unassigned",
  Assigned: "Assigned",
  InProgress: "In Progress",
  WaitingExternal: "Waiting External",
  WaitingInternal: "Waiting Internal",
  Done: "Done",
  Closed: "Closed",
};

const priorityStyles: Record<string, string> = {
  P0: "bg-red-600 text-white",
  P1: "bg-orange-500 text-white",
  P2: "bg-amber-500/20 text-amber-300",
  P3: "bg-muted text-muted-foreground",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${
        statusStyles[status] || "bg-muted text-muted-foreground"
      }`}
    >
      {statusLabels[status] || status}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span
      className={`inline-flex items-center text-xs px-1.5 py-0.5 rounded font-bold ${
        priorityStyles[priority] || "bg-muted text-muted-foreground"
      }`}
    >
      {priority}
    </span>
  );
}

// ─── Staking Reward Health ───

const rewardHealthStyles: Record<string, string> = {
  on_time: "bg-emerald-500/10 text-emerald-400",
  approaching: "bg-amber-500/10 text-amber-400",
  overdue: "bg-red-500/10 text-red-400",
  no_data: "bg-muted text-muted-foreground",
};

const rewardHealthLabels: Record<string, string> = {
  on_time: "On Time",
  approaching: "Approaching",
  overdue: "Overdue",
  no_data: "No Data",
};

export function RewardHealthBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${rewardHealthStyles[status] || "bg-muted text-muted-foreground"}`}>
      {rewardHealthLabels[status] || status}
    </span>
  );
}

// ─── Daily Check Status ───

const checkStatusStyles: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  pass: "bg-emerald-500/10 text-emerald-400",
  issues_found: "bg-red-500/10 text-red-400",
  skipped: "bg-amber-500/10 text-amber-400",
};

const checkStatusLabels: Record<string, string> = {
  pending: "Pending",
  pass: "Pass",
  issues_found: "Issues Found",
  skipped: "Skipped",
};

export function CheckStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${checkStatusStyles[status] || "bg-muted text-muted-foreground"}`}>
      {checkStatusLabels[status] || status}
    </span>
  );
}

// ─── RCA Lifecycle Status ───

const rcaStatusStyles: Record<string, string> = {
  none: "bg-muted text-muted-foreground",
  raised: "bg-blue-500/10 text-blue-400",
  awaiting_rca: "bg-amber-500/10 text-amber-400",
  rca_received: "bg-emerald-500/10 text-emerald-400",
  follow_up_pending: "bg-orange-500/10 text-orange-400",
  closed: "bg-muted text-muted-foreground",
};

const rcaStatusLabels: Record<string, string> = {
  none: "None",
  raised: "Raised",
  awaiting_rca: "Awaiting RCA",
  rca_received: "RCA Received",
  follow_up_pending: "Follow-up Pending",
  closed: "Closed",
};

export function RcaStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${rcaStatusStyles[status] || "bg-muted text-muted-foreground"}`}>
      {rcaStatusLabels[status] || status}
    </span>
  );
}

// ─── Risk Level ───

const riskLevelStyles: Record<string, string> = {
  low: "bg-emerald-500/10 text-emerald-400",
  medium: "bg-amber-500/10 text-amber-400",
  high: "bg-red-500/10 text-red-400",
};

export function RiskLevelBadge({ level }: { level: string }) {
  return (
    <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${riskLevelStyles[level] || "bg-muted text-muted-foreground"}`}>
      {level.charAt(0).toUpperCase() + level.slice(1)}
    </span>
  );
}

// ─── Screening Classification ───

const classificationStyles: Record<string, string> = {
  unclassified: "bg-muted text-muted-foreground",
  legitimate: "bg-emerald-500/10 text-emerald-400",
  dust: "bg-amber-500/10 text-amber-400",
  scam: "bg-red-500/10 text-red-400",
};

export function ClassificationBadge({ classification }: { classification: string }) {
  return (
    <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${classificationStyles[classification] || "bg-muted text-muted-foreground"}`}>
      {classification.charAt(0).toUpperCase() + classification.slice(1)}
    </span>
  );
}
