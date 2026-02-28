"use client";

const statusStyles: Record<string, string> = {
  Unassigned: "bg-slate-100 text-slate-700",
  Assigned: "bg-blue-100 text-blue-700",
  InProgress: "bg-indigo-100 text-indigo-700",
  WaitingExternal: "bg-amber-100 text-amber-700",
  WaitingInternal: "bg-orange-100 text-orange-700",
  Done: "bg-emerald-100 text-emerald-700",
  Closed: "bg-slate-100 text-slate-500",
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
  P2: "bg-yellow-400 text-yellow-900",
  P3: "bg-slate-200 text-slate-600",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${
        statusStyles[status] || "bg-slate-100 text-slate-600"
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
        priorityStyles[priority] || "bg-slate-200 text-slate-600"
      }`}
    >
      {priority}
    </span>
  );
}
