"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Search, Plus, Mail, MessageSquare, Phone, Globe, Clock,
  AlertTriangle, ChevronDown, ChevronRight, X, Save, Edit2,
} from "lucide-react";

interface ClientPreference {
  id: string;
  clientName: string;
  displayName: string;
  preferredChannel: string;
  primaryEmail: string;
  secondaryEmail: string;
  slackChannel: string;
  phoneNumber: string;
  timezone: string;
  businessHoursStart: string;
  businessHoursEnd: string;
  businessDays: string;
  language: string;
  vaspDid: string;
  travelRuleContact: string;
  escalationEmail: string;
  escalationPhone: string;
  notes: string;
  tags: string[];
  active: boolean;
  lastContactedAt: string | null;
  createdBy?: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

interface Summary {
  total: number;
  active: number;
  byChannel: Record<string, number>;
  withTravelRuleContact: number;
  withEscalation: number;
}

const CHANNEL_ICONS: Record<string, typeof Mail> = {
  email: Mail,
  slack: MessageSquare,
  phone: Phone,
  portal: Globe,
};

const CHANNEL_COLORS: Record<string, string> = {
  email: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  slack: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  phone: "bg-green-500/10 text-green-400 border-green-500/20",
  portal: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

const EMPTY_FORM = {
  clientName: "",
  displayName: "",
  preferredChannel: "email",
  primaryEmail: "",
  secondaryEmail: "",
  slackChannel: "",
  phoneNumber: "",
  timezone: "UTC",
  businessHoursStart: "09:00",
  businessHoursEnd: "17:00",
  businessDays: "mon,tue,wed,thu,fri",
  language: "en",
  vaspDid: "",
  travelRuleContact: "",
  escalationEmail: "",
  escalationPhone: "",
  notes: "",
  tags: [] as string[],
};

export default function ClientPreferencesPage() {
  const [preferences, setPreferences] = useState<ClientPreference[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const fetchPreferences = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (channelFilter) params.set("channel", channelFilter);
      params.set("active", "true");

      const res = await fetch(`/api/client-preferences?${params}`);
      const json = await res.json();
      if (json.success) {
        setPreferences(json.data.preferences);
        setSummary(json.data.summary);
      }
    } catch (err) {
      console.error("Failed to fetch preferences:", err);
    } finally {
      setLoading(false);
    }
  }, [search, channelFilter]);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const method = editingId ? "PATCH" : "POST";
      const body = editingId ? { id: editingId, ...form } : form;

      const res = await fetch("/api/client-preferences", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (json.success) {
        setShowAddForm(false);
        setEditingId(null);
        setForm(EMPTY_FORM);
        await fetchPreferences();
      }
    } catch (err) {
      console.error("Failed to save:", err);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (pref: ClientPreference) => {
    setEditingId(pref.id);
    setForm({
      clientName: pref.clientName,
      displayName: pref.displayName,
      preferredChannel: pref.preferredChannel,
      primaryEmail: pref.primaryEmail,
      secondaryEmail: pref.secondaryEmail,
      slackChannel: pref.slackChannel,
      phoneNumber: pref.phoneNumber,
      timezone: pref.timezone,
      businessHoursStart: pref.businessHoursStart,
      businessHoursEnd: pref.businessHoursEnd,
      businessDays: pref.businessDays,
      language: pref.language,
      vaspDid: pref.vaspDid,
      travelRuleContact: pref.travelRuleContact,
      escalationEmail: pref.escalationEmail,
      escalationPhone: pref.escalationPhone,
      notes: pref.notes,
      tags: pref.tags || [],
    });
    setShowAddForm(true);
  };

  return (
    <div className="min-h-screen bg-zinc-950 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">Client Contact Preferences</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Preferred communication channels for clients and counterparties
            </p>
          </div>
          <button
            onClick={() => { setShowAddForm(true); setEditingId(null); setForm(EMPTY_FORM); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-md transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Client
          </button>
        </div>

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">Total Clients</p>
              <p className="text-2xl font-bold text-zinc-100 mt-1">{summary.total}</p>
            </div>
            {Object.entries(summary.byChannel).map(([channel, count]) => {
              const Icon = CHANNEL_ICONS[channel] || Mail;
              return (
                <div key={channel} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                  <div className="flex items-center gap-1.5">
                    <Icon className="w-3.5 h-3.5 text-zinc-500" />
                    <p className="text-xs text-zinc-500 uppercase tracking-wider">{channel}</p>
                  </div>
                  <p className="text-2xl font-bold text-zinc-100 mt-1">{count}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              placeholder="Search clients..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-md text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
            />
          </div>
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-md text-sm text-zinc-300 focus:outline-none"
          >
            <option value="">All Channels</option>
            <option value="email">Email</option>
            <option value="slack">Slack</option>
            <option value="phone">Phone</option>
            <option value="portal">Portal</option>
          </select>
        </div>

        {/* Add/Edit Form */}
        {showAddForm && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-100">
                {editingId ? "Edit Client Preferences" : "New Client Preferences"}
              </h2>
              <button onClick={() => { setShowAddForm(false); setEditingId(null); }} className="text-zinc-500 hover:text-zinc-300">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField label="Client Name *" value={form.clientName} onChange={(v) => setForm({ ...form, clientName: v })} disabled={!!editingId} />
              <FormField label="Display Name" value={form.displayName} onChange={(v) => setForm({ ...form, displayName: v })} />
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Preferred Channel</label>
                <select
                  value={form.preferredChannel}
                  onChange={(e) => setForm({ ...form, preferredChannel: e.target.value })}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200"
                >
                  <option value="email">Email</option>
                  <option value="slack">Slack</option>
                  <option value="phone">Phone</option>
                  <option value="portal">Portal</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField label="Primary Email" value={form.primaryEmail} onChange={(v) => setForm({ ...form, primaryEmail: v })} />
              <FormField label="Secondary Email" value={form.secondaryEmail} onChange={(v) => setForm({ ...form, secondaryEmail: v })} />
              <FormField label="Slack Channel" value={form.slackChannel} onChange={(v) => setForm({ ...form, slackChannel: v })} placeholder="#client-channel" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField label="Phone" value={form.phoneNumber} onChange={(v) => setForm({ ...form, phoneNumber: v })} />
              <FormField label="Timezone" value={form.timezone} onChange={(v) => setForm({ ...form, timezone: v })} placeholder="Europe/London" />
              <FormField label="Language" value={form.language} onChange={(v) => setForm({ ...form, language: v })} placeholder="en" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="Business Hours Start" value={form.businessHoursStart} onChange={(v) => setForm({ ...form, businessHoursStart: v })} placeholder="09:00" />
              <FormField label="Business Hours End" value={form.businessHoursEnd} onChange={(v) => setForm({ ...form, businessHoursEnd: v })} placeholder="17:00" />
            </div>

            <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider pt-2">Travel Rule & Escalation</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="VASP DID" value={form.vaspDid} onChange={(v) => setForm({ ...form, vaspDid: v })} placeholder="did:ethr:0x..." />
              <FormField label="Travel Rule Contact Email" value={form.travelRuleContact} onChange={(v) => setForm({ ...form, travelRuleContact: v })} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="Escalation Email" value={form.escalationEmail} onChange={(v) => setForm({ ...form, escalationEmail: v })} />
              <FormField label="Escalation Phone" value={form.escalationPhone} onChange={(v) => setForm({ ...form, escalationPhone: v })} />
            </div>

            <div>
              <label className="block text-xs text-zinc-500 mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 resize-none"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => { setShowAddForm(false); setEditingId(null); }}
                className="px-4 py-2 bg-zinc-800 text-zinc-300 text-sm rounded-md hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.clientName.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-md disabled:opacity-50 transition-colors"
              >
                <Save className="w-4 h-4" />
                {saving ? "Saving..." : editingId ? "Update" : "Create"}
              </button>
            </div>
          </div>
        )}

        {/* Client List */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg divide-y divide-zinc-800">
          {loading ? (
            <div className="p-8 text-center text-zinc-500">Loading...</div>
          ) : preferences.length === 0 ? (
            <div className="p-8 text-center text-zinc-500">
              No client preferences found. Add your first client above.
            </div>
          ) : (
            preferences.map((pref) => {
              const isExpanded = expandedId === pref.id;
              const Icon = CHANNEL_ICONS[pref.preferredChannel] || Mail;
              const colorClass = CHANNEL_COLORS[pref.preferredChannel] || CHANNEL_COLORS.email;

              return (
                <div key={pref.id}>
                  <div
                    className="flex items-center gap-4 px-4 py-3 hover:bg-zinc-800/50 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : pref.id)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-zinc-500 shrink-0" />
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-zinc-200 truncate">
                          {pref.displayName || pref.clientName}
                        </p>
                        {pref.displayName && pref.displayName !== pref.clientName && (
                          <span className="text-xs text-zinc-600">({pref.clientName})</span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 truncate mt-0.5">
                        {pref.primaryEmail || pref.slackChannel || pref.phoneNumber || "No contact info"}
                      </p>
                    </div>

                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${colorClass}`}>
                      <Icon className="w-3 h-3" />
                      {pref.preferredChannel}
                    </span>

                    <div className="flex items-center gap-2 shrink-0">
                      {pref.travelRuleContact && (
                        <span className="text-xs text-emerald-500" title="Has travel rule contact">TR</span>
                      )}
                      {(pref.escalationEmail || pref.escalationPhone) && (
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                      )}
                      <Clock className="w-3.5 h-3.5 text-zinc-600" />
                      <span className="text-xs text-zinc-500">{pref.timezone}</span>
                    </div>

                    <button
                      onClick={(e) => { e.stopPropagation(); startEdit(pref); }}
                      className="p-1.5 text-zinc-500 hover:text-zinc-300 rounded"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="px-12 pb-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                      <DetailField label="Primary Email" value={pref.primaryEmail} />
                      <DetailField label="Secondary Email" value={pref.secondaryEmail} />
                      <DetailField label="Slack Channel" value={pref.slackChannel} />
                      <DetailField label="Phone" value={pref.phoneNumber} />
                      <DetailField label="Business Hours" value={`${pref.businessHoursStart}-${pref.businessHoursEnd}`} />
                      <DetailField label="Business Days" value={pref.businessDays} />
                      <DetailField label="Language" value={pref.language} />
                      <DetailField label="VASP DID" value={pref.vaspDid} />
                      <DetailField label="Travel Rule Contact" value={pref.travelRuleContact} />
                      <DetailField label="Escalation Email" value={pref.escalationEmail} />
                      <DetailField label="Escalation Phone" value={pref.escalationPhone} />
                      <DetailField label="Last Contacted" value={pref.lastContactedAt ? new Date(pref.lastContactedAt).toLocaleDateString() : "Never"} />
                      {pref.notes && (
                        <div className="col-span-full">
                          <p className="text-zinc-500">Notes</p>
                          <p className="text-zinc-300 mt-0.5">{pref.notes}</p>
                        </div>
                      )}
                      {pref.tags.length > 0 && (
                        <div className="col-span-full flex gap-1.5">
                          {pref.tags.map((tag) => (
                            <span key={tag} className="px-2 py-0.5 bg-zinc-800 text-zinc-400 rounded text-xs">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function FormField({
  label, value, onChange, placeholder, disabled,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-zinc-500 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 placeholder-zinc-600 disabled:opacity-50"
      />
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-zinc-500">{label}</p>
      <p className="text-zinc-300 mt-0.5 break-all">{value}</p>
    </div>
  );
}
