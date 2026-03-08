"use client";

import { useState } from "react";
import type { Employee } from "./EmployeesTab";

interface KnowledgeScoringTabProps {
  employees: Employee[];
}

export default function KnowledgeScoringTab({ employees }: KnowledgeScoringTabProps) {
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [knowledgeForm, setKnowledgeForm] = useState({
    operationalUnderstanding: 5,
    assetKnowledge: 5,
    complianceAwareness: 5,
    incidentResponse: 5,
    notes: "",
  });

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <h3 className="text-lg font-semibold mb-4">Crypto Knowledge Scoring</h3>
      <p className="text-sm text-muted-foreground mb-6">
        Score each employee on rubric dimensions (1-10). Score is mapped to the 3-8 dashboard range.
      </p>

      <div className="mb-4">
        <label className="text-sm font-medium block mb-1">Select Employee</label>
        <select
          value={selectedEmployee}
          onChange={(e) => setSelectedEmployee(e.target.value)}
          className="text-sm border border-border rounded-lg px-3 py-2 w-full max-w-xs"
        >
          <option value="">Choose...</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.name} ({emp.role})
            </option>
          ))}
        </select>
      </div>

      {selectedEmployee && (
        <div className="p-4 bg-muted/50 rounded-lg space-y-4">
          {[
            { key: "operationalUnderstanding", label: "Operational Understanding" },
            { key: "assetKnowledge", label: "Asset-Specific Knowledge" },
            { key: "complianceAwareness", label: "Compliance Awareness" },
            { key: "incidentResponse", label: "Incident Response Competence" },
          ].map((dim) => (
            <div key={dim.key} className="flex items-center gap-4">
              <label className="w-48 text-sm">{dim.label}</label>
              <input
                type="range"
                min={1}
                max={10}
                value={(knowledgeForm as Record<string, number | string>)[dim.key] as number}
                onChange={(e) =>
                  setKnowledgeForm((prev) => ({
                    ...prev,
                    [dim.key]: parseInt(e.target.value),
                  }))
                }
                className="flex-1"
              />
              <span className="w-12 text-sm text-right font-mono">
                {(knowledgeForm as Record<string, number | string>)[dim.key]}/10
              </span>
            </div>
          ))}
          <div>
            <label className="text-sm block mb-1">Notes</label>
            <textarea
              value={knowledgeForm.notes}
              onChange={(e) =>
                setKnowledgeForm((prev) => ({ ...prev, notes: e.target.value }))
              }
              placeholder="Training completed, areas for improvement..."
              className="w-full text-sm border border-border rounded-lg p-2 h-20"
            />
          </div>
          <button className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
            Save Knowledge Score
          </button>
        </div>
      )}
    </div>
  );
}
