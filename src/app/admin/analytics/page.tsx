"use client";

import { BarChart3, TrendingUp, Clock, AlertTriangle } from "lucide-react";

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Category deep dives — cycle time, quality trends, SLA performance, documentation velocity
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Daily Tasks Analytics */}
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-500/10 text-primary rounded-lg">
              <BarChart3 size={20} />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Daily Tasks Analytics</h3>
              <p className="text-xs text-muted-foreground">Cycle time, on-time rate, throughput</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Avg Cycle Time</span>
              <span className="font-medium">2.3 days</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">On-Time Rate</span>
              <span className="font-medium">87%</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Team Throughput</span>
              <span className="font-medium">94 tickets/week</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Reopened Rate</span>
              <span className="font-medium text-amber-600">4.2%</span>
            </div>
          </div>
        </div>

        {/* Quality Analytics */}
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-red-500/10 text-red-600 rounded-lg">
              <AlertTriangle size={20} />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Quality Analytics</h3>
              <p className="text-xs text-muted-foreground">Mistakes by type/severity, trends</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total Mistakes (month)</span>
              <span className="font-medium">7</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">High Severity</span>
              <span className="font-medium text-red-600">1</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Positive Actions</span>
              <span className="font-medium text-emerald-600">12</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Net Quality Trend</span>
              <span className="font-medium text-emerald-600">Improving</span>
            </div>
          </div>
        </div>

        {/* Asset Actions Analytics */}
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg">
              <TrendingUp size={20} />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Asset Actions Analytics</h3>
              <p className="text-xs text-muted-foreground">Actions by type, SLA compliance</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Actions Completed</span>
              <span className="font-medium">156</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">SLA Compliance</span>
              <span className="font-medium">92%</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Avg Completion Time</span>
              <span className="font-medium">47 min</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Rejection Rate</span>
              <span className="font-medium">2.1%</span>
            </div>
          </div>
        </div>

        {/* Comms Analytics */}
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-emerald-500/10 text-emerald-600 rounded-lg">
              <Clock size={20} />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Communications Analytics</h3>
              <p className="text-xs text-muted-foreground">TTO, TTFA, resolution, reassignment</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Avg Time-to-Ownership</span>
              <span className="font-medium">23 min</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Avg Time-to-First-Action</span>
              <span className="font-medium">41 min</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">SLA Breach Rate</span>
              <span className="font-medium text-amber-600">8%</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Reassignment Rate</span>
              <span className="font-medium">12%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-muted/50 border border-border rounded-xl p-6 text-center">
        <BarChart3 size={32} className="mx-auto text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">
          Full chart visualisations will be available once integrated with live Jira, Confluence,
          and transaction system data. The metrics above show representative values from current data.
        </p>
      </div>
    </div>
  );
}
