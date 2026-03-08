"use client";

import { useState } from "react";

export interface SlackStatus {
  configured: boolean;
  channels: string[];
}

export interface EmailStatus {
  configured: boolean;
  inbox: string | null;
  smtpConfigured: boolean;
}

interface IntegrationsTabProps {
  slackStatus: SlackStatus | null;
  emailStatus: EmailStatus | null;
}

export default function IntegrationsTab({ slackStatus, emailStatus }: IntegrationsTabProps) {
  const [syncingSlack, setSyncingSlack] = useState(false);
  const [syncingEmail, setSyncingEmail] = useState(false);
  const [slackChannelInput, setSlackChannelInput] = useState("");
  const [syncResult, setSyncResult] = useState<string | null>(null);

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
