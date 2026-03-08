export interface Employee {
  id: string;
  name: string;
  team: string;
  role: string;
}

export interface OnCallEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  team: string;
  shiftType: string;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
  region: string;
}

export interface PtoEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeTeam?: string;
  startDate: string;
  endDate: string;
  type: string;
  status: string;
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
  priority: string;
  status: string;
  category: string;
  completedAt: string | null;
  createdByName: string;
}

export interface TeamSummary {
  team: string;
  teamLead: string;
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  onCall: Array<{ employeeName: string; shiftType: string }>;
  ptoToday: Array<{ employeeName: string; type: string }>;
  tasks: DailyTaskEntry[];
}

export interface DailySummary {
  date: string;
  holidays: Array<{ name: string; region: string }>;
  teams: TeamSummary[];
}

export interface RotaMember {
  id: string;
  employeeId: string;
  employeeName: string;
  location: string;
  shiftType: string;
  isWfh: boolean;
  hasPto: boolean;
}

export interface RotaPeriod {
  startDate: string;
  endDate: string;
  rotationCycle: string;
  lead: RotaMember | null;
  members: RotaMember[];
}

export interface RotaSubTeam {
  subTeam: {
    id: string;
    name: string;
    parentTeam: string;
    description: string;
  };
  periods: RotaPeriod[];
}

export interface RotaData {
  subTeams: RotaSubTeam[];
  holidays: Array<{ date: string; name: string; region: string }>;
  pto: Array<{ employeeId: string; employeeName: string; startDate: string; endDate: string; type: string }>;
}

export type Tab = "rota" | "daily" | "oncall" | "holidays" | "pto";

export const TEAMS = ["Transaction Operations", "Admin Operations", "Data Operations"];
