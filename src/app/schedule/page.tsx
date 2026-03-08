"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";

import type { Employee, OnCallEntry, Holiday, PtoEntry, DailySummary, RotaData, Tab } from "./types";
import { TEAMS } from "./types";
import ScheduleHeader from "./ScheduleHeader";
import OnCallRota, { OnCallSchedule } from "./OnCallRota";
import PtoSection from "./PtoSection";
import HolidaysSection from "./HolidaysSection";
import DailyTasksSection from "./DailyTasksSection";

export default function SchedulePage() {
  const [activeTab, setActiveTab] = useState<Tab>("rota");
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return d.toISOString().split("T")[0];
  });
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [onCallEntries, setOnCallEntries] = useState<OnCallEntry[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [ptoEntries, setPtoEntries] = useState<PtoEntry[]>([]);
  const [rotaData, setRotaData] = useState<RotaData | null>(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showAddOnCall, setShowAddOnCall] = useState(false);
  const [showAddHoliday, setShowAddHoliday] = useState(false);
  const [showAddPto, setShowAddPto] = useState(false);
  const [newTask, setNewTask] = useState({ team: TEAMS[0], title: "", description: "", priority: "normal", category: "operational", assigneeId: "" });
  const [newOnCall, setNewOnCall] = useState({ team: TEAMS[0], employeeId: "", shiftType: "primary" });
  const [newHoliday, setNewHoliday] = useState({ name: "", region: "Global" });
  const [newPto, setNewPto] = useState({ employeeId: "", startDate: selectedDate, endDate: selectedDate, type: "annual_leave", notes: "" });

  // ─── Data fetching ───

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fetchJson = useCallback(async (url: string, onSuccess: (data: any) => void, showLoading = true) => {
    if (showLoading) setLoading(true);
    try { const json = await (await fetch(url)).json(); if (json.success) onSuccess(json.data); } catch { /* ignore */ }
    if (showLoading) setLoading(false);
  }, []);

  const fetchEmployees = useCallback(() => fetchJson("/api/employees", (d) => setEmployees(d || []), false), [fetchJson]);

  const fetchDailySummary = useCallback(() =>
    fetchJson(`/api/schedule/daily-tasks/summary?date=${selectedDate}`, setDailySummary), [fetchJson, selectedDate]);

  const fetchOnCall = useCallback(() => {
    const d = new Date(selectedDate);
    const from = new Date(d.getTime() - 3 * 86400000).toISOString().split("T")[0];
    const to = new Date(d.getTime() + 7 * 86400000).toISOString().split("T")[0];
    return fetchJson(`/api/schedule/on-call?from=${from}&to=${to}`, (d) => setOnCallEntries(d || []));
  }, [fetchJson, selectedDate]);

  const fetchHolidays = useCallback(() => {
    const year = new Date(selectedDate).getFullYear();
    return fetchJson(`/api/schedule/holidays?year=${year}`, (d) => setHolidays(d || []));
  }, [fetchJson, selectedDate]);

  const fetchRota = useCallback(() => {
    const d = new Date(selectedDate);
    const weekday = d.getDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    const monday = new Date(d.getTime() + mondayOffset * 86400000);
    const from = monday.toISOString().split("T")[0];
    const to = new Date(monday.getTime() + 13 * 86400000).toISOString().split("T")[0];
    return fetchJson(`/api/schedule/rota?from=${from}&to=${to}&team=Transaction Operations`, setRotaData);
  }, [fetchJson, selectedDate]);

  const fetchPto = useCallback(() => {
    const d = new Date(selectedDate);
    const from = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split("T")[0];
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split("T")[0];
    return fetchJson(`/api/schedule/pto?from=${from}&to=${to}`, (d) => setPtoEntries(d || []));
  }, [fetchJson, selectedDate]);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  useEffect(() => {
    const fetchers: Record<Tab, () => void> = { rota: fetchRota, daily: fetchDailySummary, oncall: fetchOnCall, holidays: fetchHolidays, pto: fetchPto };
    fetchers[activeTab]();
  }, [activeTab, selectedDate, fetchRota, fetchDailySummary, fetchOnCall, fetchHolidays, fetchPto]);

  // ─── Action handlers ───

  function changeDate(delta: number) {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta);
    setSelectedDate(d.toISOString().split("T")[0]);
  }

  const postJson = async (url: string, body: object, method = "POST") => {
    await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  };

  async function handleAddTask() {
    if (!newTask.title) return;
    await postJson("/api/schedule/daily-tasks", { ...newTask, date: selectedDate, assigneeId: newTask.assigneeId || null });
    setShowAddTask(false);
    setNewTask({ team: TEAMS[0], title: "", description: "", priority: "normal", category: "operational", assigneeId: "" });
    fetchDailySummary();
  }

  async function handleTaskStatusChange(taskId: string, status: string) {
    await postJson("/api/schedule/daily-tasks", { id: taskId, status }, "PATCH");
    fetchDailySummary();
  }

  async function handleAddOnCall() {
    if (!newOnCall.employeeId) return;
    await postJson("/api/schedule/on-call", { ...newOnCall, date: selectedDate });
    setShowAddOnCall(false);
    setNewOnCall({ team: TEAMS[0], employeeId: "", shiftType: "primary" });
    fetchOnCall();
  }

  async function handleAddHoliday() {
    if (!newHoliday.name) return;
    await postJson("/api/schedule/holidays", { ...newHoliday, date: selectedDate });
    setShowAddHoliday(false);
    setNewHoliday({ name: "", region: "Global" });
    fetchHolidays();
  }

  async function handleAddPto() {
    if (!newPto.employeeId) return;
    await postJson("/api/schedule/pto", newPto);
    setShowAddPto(false);
    setNewPto({ employeeId: "", startDate: selectedDate, endDate: selectedDate, type: "annual_leave", notes: "" });
    fetchPto();
  }

  // ─── Render ───

  return (
    <div className="space-y-4 md:space-y-6">
      <ScheduleHeader
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        changeDate={changeDate}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        dailySummary={dailySummary}
      />

      {loading ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center text-muted-foreground">
          <RefreshCw size={24} className="mx-auto mb-3 animate-spin" />
          Loading...
        </div>
      ) : activeTab === "rota" ? (
        <OnCallRota rotaData={rotaData} />
      ) : activeTab === "daily" ? (
        <DailyTasksSection
          summary={dailySummary}
          employees={employees}
          showAdd={showAddTask}
          setShowAdd={setShowAddTask}
          newTask={newTask}
          setNewTask={setNewTask}
          onAdd={handleAddTask}
          onStatusChange={handleTaskStatusChange}
        />
      ) : activeTab === "oncall" ? (
        <OnCallSchedule
          entries={onCallEntries}
          selectedDate={selectedDate}
          employees={employees}
          showAdd={showAddOnCall}
          setShowAdd={setShowAddOnCall}
          newOnCall={newOnCall}
          setNewOnCall={setNewOnCall}
          onAdd={handleAddOnCall}
        />
      ) : activeTab === "holidays" ? (
        <HolidaysSection
          holidays={holidays}
          showAdd={showAddHoliday}
          setShowAdd={setShowAddHoliday}
          newHoliday={newHoliday}
          setNewHoliday={setNewHoliday}
          onAdd={handleAddHoliday}
        />
      ) : (
        <PtoSection
          entries={ptoEntries}
          employees={employees}
          showAdd={showAddPto}
          setShowAdd={setShowAddPto}
          newPto={newPto}
          setNewPto={setNewPto}
          onAdd={handleAddPto}
        />
      )}
    </div>
  );
}
