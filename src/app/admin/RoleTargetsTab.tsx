"use client";

import type { ScoringConfigData } from "@/types";

interface RoleTargetsTabProps {
  config: ScoringConfigData;
}

export default function RoleTargetsTab({ config }: RoleTargetsTabProps) {
  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <h3 className="text-lg font-semibold mb-4">Role-Based Targets</h3>
      <p className="text-sm text-muted-foreground mb-6">
        Different targets by seniority level to ensure fair comparison.
      </p>
      <div className="space-y-6">
        {Object.entries(config.targets || {}).map(([role, targets]) => {
          if (!targets?.daily_tasks || !targets?.projects || !targets?.asset_actions || !targets?.quality) {
            return (
              <div key={role} className="p-4 bg-muted/50 rounded-lg">
                <h4 className="text-sm font-semibold text-foreground mb-3">{role}</h4>
                <p className="text-sm text-muted-foreground">Target data incomplete for this role.</p>
              </div>
            );
          }
          return (
            <div key={role} className="p-4 bg-muted/50 rounded-lg">
              <h4 className="text-sm font-semibold text-foreground mb-3">{role}</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Tickets/Week</p>
                  <p className="text-sm font-semibold">{targets.daily_tasks.ticketsPerWeek}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">On-Time Rate</p>
                  <p className="text-sm font-semibold">{(targets.daily_tasks.onTimeRate * 100).toFixed(0)}%</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Pages Created/Mo</p>
                  <p className="text-sm font-semibold">{targets.projects.pagesCreatedPerMonth}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Actions/Week</p>
                  <p className="text-sm font-semibold">{targets.asset_actions.actionsPerWeek}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Max Mistakes</p>
                  <p className="text-sm font-semibold">{targets.quality.maxMistakes}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Positive Actions Target</p>
                  <p className="text-sm font-semibold">{targets.quality.positiveActionsTarget}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">SLA Compliance</p>
                  <p className="text-sm font-semibold">
                    {(targets.asset_actions.slaComplianceRate * 100).toFixed(0)}%
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Cycle Time Target</p>
                  <p className="text-sm font-semibold">{targets.daily_tasks.cycleTimeDays}d</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
