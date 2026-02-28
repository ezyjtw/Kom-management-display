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
