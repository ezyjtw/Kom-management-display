// ─── Project Types ───

export type ProjectStatus = "planned" | "active" | "on_hold" | "completed" | "cancelled";
export type ProjectPriority = "low" | "medium" | "high" | "critical";
export type UpdateType = "progress" | "blocker" | "milestone" | "note";

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  team: string;
  leadId: string;
  leadName: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  startDate: string | null;
  targetDate: string | null;
  progress: number;
  tags: string[];
  memberCount: number;
  latestUpdate: string | null;
  latestUpdateAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetail extends ProjectSummary {
  members: Array<{
    id: string;
    employeeId: string;
    employeeName: string;
    role: string;
  }>;
  updates: Array<{
    id: string;
    authorId: string;
    authorName: string;
    content: string;
    type: UpdateType;
    progress: number | null;
    createdAt: string;
  }>;
}
