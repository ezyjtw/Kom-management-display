// ─── Scoring Types ───

export type Category = "daily_tasks" | "projects" | "asset_actions" | "quality" | "knowledge";

export type ScoreRange = { min: 3; max: 8 };

export interface CategoryWeight {
  daily_tasks: number;
  projects: number;
  asset_actions: number;
  quality: number;
  knowledge: number;
}

export interface ScoringConfigData {
  version: string;
  weights: CategoryWeight;
  targets: Record<string, RoleTargets>;
  clampMin: number;
  clampMax: number;
  definitions: DataDefinitions;
}

export interface RoleTargets {
  daily_tasks: { ticketsPerWeek: number; onTimeRate: number; cycleTimeDays: number };
  projects: { pagesCreatedPerMonth: number; pagesUpdatedPerMonth: number };
  asset_actions: { actionsPerWeek: number; slaComplianceRate: number };
  quality: { maxMistakes: number; positiveActionsTarget: number };
}

export interface DataDefinitions {
  jira: {
    doneStatuses: string[];
    issueTypes: string[];
    creditRule: "assignee_at_completion" | "current_assignee";
    reopenedHandling: "quality_penalty" | "tracked_only";
  };
  confluence: {
    qualifyingSpaces: string[];
    qualifyingLabels: string[];
    createWeight: number;
    updateWeight: number;
  };
  assetActions: {
    countableTypes: string[];
    performedMeans: "completed" | "approved" | "initiated";
    multiApproverCredit: "all_approvers" | "final_approver";
  };
  quality: {
    severityWeights: { low: number; medium: number; high: number };
    positiveActionDefinition: string;
  };
  knowledge: {
    rubricDimensions: string[];
    cadence: "monthly" | "quarterly";
  };
}
