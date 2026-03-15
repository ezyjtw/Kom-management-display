"use client";

import { useState, useEffect, useCallback } from "react";

export interface SlackStatus {
  configured: boolean;
  channels: string[];
}

export interface EmailStatus {
  configured: boolean;
  inbox: string | null;
  smtpConfigured: boolean;
}

interface SlackChannelRecord {
  id: string;
  channelId: string;
  channelName: string;
  channelType: string;
  linkedEntityId: string | null;
  isActive: boolean;
  lastSyncedAt: string | null;
}

interface IntegrationsTabProps {
  slackStatus: SlackStatus | null;
  emailStatus: EmailStatus | null;
}

const CHANNEL_TYPE_BADGES: Record<string, { label: string; className: string }> = {
  client: { label: "CLIENT", className: "bg-blue-500/10 text-blue-400" },
  service_provider: { label: "PROVIDER", className: "bg-purple-500/10 text-purple-400" },
  internal: { label: "INTERNAL", className: "bg-amber-500/10 text-amber-400" },
};

export default function IntegrationsTab({ slackStatus, emailStatus }: IntegrationsTabProps) {
  const [syncingSlack, setSyncingSlack] = useState(false);
  const [syncingEmail, setSyncingEmail] = useState(false);
  const [slackChannelInput, setSlackChannelInput] = useState("");
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Slack Channels registry state
  const [registeredChannels, setRegisteredChannels] = useState<SlackChannelRecord[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [registerForm, setRegisterForm] = useState({
    channelId: "",
    channelName: "",
    channelType: "internal" as "client" | "service_provider" | "internal",
    linkedEntityId: "",
  });
  const [registering, setRegistering] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchRegisteredChannels = useCallback(async () => {
    setLoadingChannels(true);
    try {
      const res = await fetch("/api/integrations/slack/channels");
      const json = await res.json();
      if (json.success) {
        setRegisteredChannels(json.data);
      }
    } catch {
      // Silently fail — channels section will show empty
    } finally {
      setLoadingChannels(false);
    }
  }, []);

  useEffect(() => {
    if (slackStatus?.configured) {
      fetchRegisteredChannels();
    }
  }, [slackStatus?.configured, fetchRegisteredChannels]);

  async function triggerSlackSync() {
    if (!slackChannelInput.trim()) return;
    setSyncingSlack(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/integrations/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: slackChannelInput.trim() }),
      });
      const json = await res.json();
      setSyncResult(json.success
        ? `Slack sync complete: ${json.data.threadsSynced} threads from #${json.data.channelName}`
        : `Slack sync error: ${json.error}`);
    } catch (err) {
      setSyncResult(`Sync failed: ${String(err)}`);
    } finally {
      setSyncingSlack(false);
    }
  }

  async function triggerEmailSync() {
    setSyncingEmail(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/integrations/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      setSyncResult(json.success
        ? `Email sync complete: ${json.data.threadsSynced} threads from ${json.data.inbox}`
        : `Email sync error: ${json.error}`);
    } catch (err) {
      setSyncResult(`Sync failed: ${String(err)}`);
    } finally {
      setSyncingEmail(false);
    }
  }

  async function registerChannel() {
    if (!registerForm.channelId.trim() || !registerForm.channelName.trim()) return;
    setRegistering(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/integrations/slack/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: registerForm.channelId.trim(),
          channelName: registerForm.channelName.trim(),
          channelType: registerForm.channelType,
          linkedEntityId: registerForm.linkedEntityId.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setSyncResult(`Channel #${registerForm.channelName} registered successfully`);
        setShowRegisterModal(false);
        setRegisterForm({ channelId: "", channelName: "", channelType: "internal", linkedEntityId: "" });
        fetchRegisteredChannels();
      } else {
        setSyncResult(`Registration error: ${json.error}`);
      }
    } catch (err) {
      setSyncResult(`Registration failed: ${String(err)}`);
    } finally {
      setRegistering(false);
    }
  }

  async function toggleChannelActive(channel: SlackChannelRecord) {
    setTogglingId(channel.id);
    try {
      const res = await fetch(`/api/integrations/slack/channels/${channel.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !channel.isActive }),
      });
      const json = await res.json();
      if (json.success) {
        setRegisteredChannels((prev) =>
          prev.map((ch) => (ch.id === channel.id ? { ...ch, isActive: !ch.isActive } : ch)),
        );
      }
    } catch {
      // Silently fail
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Slack Integration */}
      <div className="bg-card rounded-xl border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold">Slack Integration</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Connect Slack channels to automatically import messages as comms threads.
            </p>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full ${
            slackStatus?.configured
              ? "bg-emerald-500/10 text-emerald-400"
              : "bg-red-500/10 text-red-400"
          }`}>
            {slackStatus?.configured ? "Connected" : "Not Configured"}
          </span>
        </div>

        {!slackStatus?.configured ? (
          <div className="p-4 bg-muted/50 rounded-lg">
            <h4 className="text-sm font-semibold mb-2">Setup Instructions</h4>
            <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
              <li>Create a Slack App at api.slack.com/apps</li>
              <li>Add Bot Token Scopes: <code className="text-xs bg-muted px-1 py-0.5 rounded">channels:history</code>, <code className="text-xs bg-muted px-1 py-0.5 rounded">channels:read</code>, <code className="text-xs bg-muted px-1 py-0.5 rounded">chat:write</code></li>
              <li>Install the app to your workspace</li>
              <li>Copy the Bot User OAuth Token</li>
              <li>Set <code className="text-xs bg-muted px-1 py-0.5 rounded">SLACK_BOT_TOKEN</code> in your <code className="text-xs bg-muted px-1 py-0.5 rounded">.env</code> file</li>
              <li>Optionally set <code className="text-xs bg-muted px-1 py-0.5 rounded">SLACK_CHANNELS</code> (comma-separated channel IDs)</li>
              <li>Restart the server</li>
            </ol>
          </div>
        ) : (
          <div className="space-y-4">
            {slackStatus.channels.length > 0 && (
              <div>
                <p className="text-sm text-muted-foreground mb-1">Configured channels:</p>
                <div className="flex gap-2 flex-wrap">
                  {slackStatus.channels.map((ch) => (
                    <span key={ch} className="text-xs bg-muted px-2 py-1 rounded">{ch}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={slackChannelInput}
                onChange={(e) => setSlackChannelInput(e.target.value)}
                placeholder="Channel ID (e.g. C01234ABCDE)"
                className="text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground w-72"
              />
              <button
                onClick={triggerSlackSync}
                disabled={syncingSlack}
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {syncingSlack ? "Syncing..." : "Sync Channel"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Slack Channels Registry */}
      {slackStatus?.configured && (
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold">Slack Channels Registry</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Registered channels are automatically synced every 2 minutes.
              </p>
            </div>
            <button
              onClick={() => setShowRegisterModal(true)}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
            >
              Register Channel
            </button>
          </div>

          {loadingChannels ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading channels...</div>
          ) : registeredChannels.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No channels registered yet. Click &quot;Register Channel&quot; to add one.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-2">Channel Name</th>
                    <th className="text-left px-3 py-2">Type</th>
                    <th className="text-left px-3 py-2">Linked Entity</th>
                    <th className="text-left px-3 py-2">Last Synced</th>
                    <th className="text-center px-3 py-2">Active</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  {registeredChannels.map((ch) => {
                    const badge = CHANNEL_TYPE_BADGES[ch.channelType] || {
                      label: ch.channelType.toUpperCase(),
                      className: "bg-gray-500/10 text-gray-400",
                    };
                    return (
                      <tr key={ch.id} className="border-b border-border">
                        <td className="px-3 py-2 font-medium text-foreground">
                          #{ch.channelName}
                          <span className="text-xs text-muted-foreground ml-2">{ch.channelId}</span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${badge.className}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {ch.linkedEntityId || <span className="text-muted-foreground/50">--</span>}
                        </td>
                        <td className="px-3 py-2">
                          {ch.lastSyncedAt
                            ? new Date(ch.lastSyncedAt).toLocaleString()
                            : <span className="text-muted-foreground/50">Never</span>}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => toggleChannelActive(ch)}
                            disabled={togglingId === ch.id}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              ch.isActive ? "bg-emerald-500" : "bg-gray-600"
                            } ${togglingId === ch.id ? "opacity-50" : ""}`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                ch.isActive ? "translate-x-6" : "translate-x-1"
                              }`}
                            />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Channel Registration Modal */}
      {showRegisterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card rounded-xl border border-border p-6 w-full max-w-md shadow-xl">
            <h3 className="text-lg font-semibold mb-4">Register Slack Channel</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Channel ID</label>
                <input
                  type="text"
                  value={registerForm.channelId}
                  onChange={(e) => setRegisterForm((f) => ({ ...f, channelId: e.target.value }))}
                  placeholder="C01234ABCDE"
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Channel Name</label>
                <input
                  type="text"
                  value={registerForm.channelName}
                  onChange={(e) => setRegisterForm((f) => ({ ...f, channelName: e.target.value }))}
                  placeholder="client-acme"
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Channel Type</label>
                <select
                  value={registerForm.channelType}
                  onChange={(e) => setRegisterForm((f) => ({ ...f, channelType: e.target.value as any }))}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground"
                >
                  <option value="client">Client</option>
                  <option value="service_provider">Service Provider</option>
                  <option value="internal">Internal</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Linked Entity ID (optional)</label>
                <input
                  type="text"
                  value={registerForm.linkedEntityId}
                  onChange={(e) => setRegisterForm((f) => ({ ...f, linkedEntityId: e.target.value }))}
                  placeholder="e.g. client preference or provider ID"
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowRegisterModal(false)}
                className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={registerChannel}
                disabled={registering || !registerForm.channelId.trim() || !registerForm.channelName.trim()}
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {registering ? "Registering..." : "Register"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email Integration */}
      <div className="bg-card rounded-xl border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold">Email Integration</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Connect an email inbox (IMAP) to automatically import emails as comms threads.
            </p>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full ${
            emailStatus?.configured
              ? "bg-emerald-500/10 text-emerald-400"
              : "bg-red-500/10 text-red-400"
          }`}>
            {emailStatus?.configured ? "Connected" : "Not Configured"}
          </span>
        </div>

        {!emailStatus?.configured ? (
          <div className="p-4 bg-muted/50 rounded-lg">
            <h4 className="text-sm font-semibold mb-2">Setup Instructions</h4>
            <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
              <li>For Gmail: Enable IMAP in Gmail settings, generate an App Password</li>
              <li>For Outlook/Exchange: Use your email server&apos;s IMAP settings</li>
              <li>Set these environment variables in <code className="text-xs bg-muted px-1 py-0.5 rounded">.env</code>:</li>
            </ol>
            <pre className="mt-2 text-xs bg-background border border-border rounded-lg p-3 overflow-x-auto">{`IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=ops-inbox@yourcompany.com
IMAP_PASSWORD=your-app-password
IMAP_TLS=true

# For sending notifications (optional):
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=ops-inbox@yourcompany.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=ops@yourcompany.com`}</pre>
            <p className="text-xs text-muted-foreground mt-2">Restart the server after setting these values.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Connected inbox</p>
                <p className="text-sm font-medium">{emailStatus.inbox}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">SMTP (outbound)</p>
                <p className="text-sm font-medium">{emailStatus.smtpConfigured ? "Configured" : "Not set up"}</p>
              </div>
            </div>
            <button
              onClick={triggerEmailSync}
              disabled={syncingEmail}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {syncingEmail ? "Syncing..." : "Sync Inbox Now"}
            </button>
          </div>
        )}
      </div>

      {/* Sync result message */}
      {syncResult && (
        <div className={`p-4 rounded-lg text-sm ${
          syncResult.includes("error") || syncResult.includes("failed")
            ? "bg-red-500/10 text-red-400 border border-red-500/20"
            : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
        }`}>
          {syncResult}
        </div>
      )}

      {/* Environment Variables Reference */}
      <div className="bg-card rounded-xl border border-border p-6">
        <h3 className="text-lg font-semibold mb-4">Environment Variables Reference</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2">Variable</th>
                <th className="text-left px-3 py-2">Purpose</th>
                <th className="text-center px-3 py-2">Required</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              <tr className="border-b border-border">
                <td className="px-3 py-2 font-mono text-xs">NEXTAUTH_SECRET</td>
                <td className="px-3 py-2">Session encryption key</td>
                <td className="px-3 py-2 text-center">Yes (production)</td>
              </tr>
              <tr className="border-b border-border">
                <td className="px-3 py-2 font-mono text-xs">NEXTAUTH_URL</td>
                <td className="px-3 py-2">App base URL (e.g. https://ops.yourcompany.com)</td>
                <td className="px-3 py-2 text-center">Yes (production)</td>
              </tr>
              <tr className="border-b border-border">
                <td className="px-3 py-2 font-mono text-xs">SLACK_BOT_TOKEN</td>
                <td className="px-3 py-2">Slack Bot User OAuth Token</td>
                <td className="px-3 py-2 text-center">For Slack</td>
              </tr>
              <tr className="border-b border-border">
                <td className="px-3 py-2 font-mono text-xs">SLACK_CHANNELS</td>
                <td className="px-3 py-2">Comma-separated Slack channel IDs to sync</td>
                <td className="px-3 py-2 text-center">Optional</td>
              </tr>
              <tr className="border-b border-border">
                <td className="px-3 py-2 font-mono text-xs">IMAP_HOST</td>
                <td className="px-3 py-2">IMAP server hostname</td>
                <td className="px-3 py-2 text-center">For Email</td>
              </tr>
              <tr className="border-b border-border">
                <td className="px-3 py-2 font-mono text-xs">IMAP_USER</td>
                <td className="px-3 py-2">IMAP login email</td>
                <td className="px-3 py-2 text-center">For Email</td>
              </tr>
              <tr className="border-b border-border">
                <td className="px-3 py-2 font-mono text-xs">IMAP_PASSWORD</td>
                <td className="px-3 py-2">IMAP password / app password</td>
                <td className="px-3 py-2 text-center">For Email</td>
              </tr>
              <tr className="border-b border-border">
                <td className="px-3 py-2 font-mono text-xs">SMTP_HOST</td>
                <td className="px-3 py-2">SMTP server for outbound notifications</td>
                <td className="px-3 py-2 text-center">Optional</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
