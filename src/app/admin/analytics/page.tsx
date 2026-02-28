"use client";

import { BarChart3, TrendingUp, Clock, AlertTriangle } from "lucide-react";

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Analytics</h1>
        <p className="text-sm text-slate-500 mt-1">
          Category deep dives — cycle time, quality trends, SLA performance, documentation velocity
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Daily Tasks Analytics */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
              <BarChart3 size={20} />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Daily Tasks Analytics</h3>
              <p className="text-xs text-slate-500">Cycle time, on-time rate, throughput</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Avg Cycle Time</span>
              <span className="font-medium">2.3 days</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">On-Time Rate</span>
              <span className="font-medium">87%</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Team Throughput</span>
              <span className="font-medium">94 tickets/week</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Reopened Rate</span>
              <span className="font-medium text-amber-600">4.2%</span>
            </div>
          </div>
        </div>

        {/* Quality Analytics */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-red-50 text-red-600 rounded-lg">
              <AlertTriangle size={20} />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Quality Analytics</h3>
              <p className="text-xs text-slate-500">Mistakes by type/severity, trends</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Total Mistakes (month)</span>
              <span className="font-medium">7</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">High Severity</span>
              <span className="font-medium text-red-600">1</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Positive Actions</span>
              <span className="font-medium text-emerald-600">12</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Net Quality Trend</span>
              <span className="font-medium text-emerald-600">Improving</span>
            </div>
          </div>
        </div>

        {/* Asset Actions Analytics */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              <TrendingUp size={20} />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Asset Actions Analytics</h3>
              <p className="text-xs text-slate-500">Actions by type, SLA compliance</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Actions Completed</span>
              <span className="font-medium">156</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">SLA Compliance</span>
              <span className="font-medium">92%</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Avg Completion Time</span>
              <span className="font-medium">47 min</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Rejection Rate</span>
              <span className="font-medium">2.1%</span>
            </div>
          </div>
        </div>

        {/* Comms Analytics */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
              <Clock size={20} />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Communications Analytics</h3>
              <p className="text-xs text-slate-500">TTO, TTFA, resolution, reassignment</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Avg Time-to-Ownership</span>
              <span className="font-medium">23 min</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Avg Time-to-First-Action</span>
              <span className="font-medium">41 min</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">SLA Breach Rate</span>
              <span className="font-medium text-amber-600">8%</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Reassignment Rate</span>
              <span className="font-medium">12%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center">
        <BarChart3 size={32} className="mx-auto text-slate-300 mb-3" />
        <p className="text-sm text-slate-500">
          Full chart visualisations will be available once integrated with live Jira, Confluence,
          and transaction system data. The metrics above show representative values from current data.
        </p>
      </div>
    </div>
  );
}
