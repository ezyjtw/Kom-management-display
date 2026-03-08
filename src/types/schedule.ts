// ─── Schedule & On-Call Types ───

export type ShiftType = "primary" | "backup";
export type PtoType = "annual_leave" | "sick" | "wfh" | "other";
export type PtoStatus = "pending" | "approved" | "rejected";
export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type TaskStatus = "pending" | "in_progress" | "completed" | "skipped";
export type TaskCategory = "operational" | "compliance" | "client" | "administrative";

export interface OnCallEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  team: string;
  shiftType: ShiftType;
}

export interface PublicHolidayEntry {
  id: string;
  date: string;
  name: string;
  region: string;
}

export interface PtoEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  startDate: string;
  endDate: string;
  type: PtoType;
  status: PtoStatus;
  notes: string;
}

export interface DailyTaskEntry {
  id: string;
  date: string;
  team: string;
  assigneeId: string | null;
  assigneeName: string | null;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  category: TaskCategory;
  completedAt: string | null;
  createdById: string;
  createdByName: string;
}

export interface DailyTaskSummary {
  team: string;
  teamLead: string;
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  tasks: DailyTaskEntry[];
}
