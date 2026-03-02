"use client";

import Link from "next/link";
import { Mail, MessageCircle, Clock, User, Ticket } from "lucide-react";
import { StatusBadge, PriorityBadge } from "@/components/shared/StatusBadge";
import { formatSlaRemaining } from "@/lib/sla";
import type { ThreadSummary } from "@/types";

interface ThreadListProps {
  threads: ThreadSummary[];
}

function getSlaBadgeClass(remaining: number | null): string {
  if (remaining === null) return "";
  if (remaining < 0) return "sla-breach";
  if (remaining < 30) return "sla-warning";
  return "sla-ok";
}

function getAgeLabel(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ThreadList({ threads }: ThreadListProps) {
  if (threads.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-8 sm:p-12 text-center">
        <MessageCircle size={32} className="mx-auto text-muted-foreground mb-3" />
        <p className="text-muted-foreground">No threads matching your filters</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="divide-y divide-border">
        {threads.map((thread) => {
          const SourceIcon = thread.source === "email" ? Mail : thread.source === "jira" ? Ticket : MessageCircle;
          const mostUrgentSla = [
            thread.slaStatus.ttoRemaining,
            thread.slaStatus.ttfaRemaining,
            thread.slaStatus.tslaRemaining,
          ]
            .filter((v): v is number => v !== null)
            .sort((a, b) => a - b)[0];

          const isBreaching =
            thread.slaStatus.isTtoBreached ||
            thread.slaStatus.isTtfaBreached ||
            thread.slaStatus.isTslaBreached;

          return (
            <Link
              key={thread.id}
              href={`/comms/thread/${thread.id}`}
              className={`block px-3 py-3 sm:px-5 sm:py-4 hover:bg-accent/50 transition-colors ${
                isBreaching ? "bg-red-500/10" : ""
              }`}
            >
              {/* Desktop layout */}
              <div className="hidden sm:flex items-center gap-4">
                {/* Source icon */}
                <div className="flex-shrink-0">
                  <SourceIcon
                    size={18}
                    className={thread.source === "email" ? "text-primary" : thread.source === "jira" ? "text-blue-500" : "text-purple-500"}
                  />
                </div>

                {/* Main content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <PriorityBadge priority={thread.priority} />
                    <span className="text-sm font-medium text-foreground truncate">
                      {thread.subject}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {thread.clientOrPartnerTag && (
                      <span className="bg-muted px-1.5 py-0.5 rounded">
                        {thread.clientOrPartnerTag}
                      </span>
                    )}
                    <span>{thread.queue}</span>
                    <span className="flex items-center gap-1">
                      <Clock size={11} />
                      {getAgeLabel(thread.lastMessageAt)}
                    </span>
                  </div>
                </div>

                {/* Status + Owner */}
                <div className="flex items-center gap-3 flex-shrink-0">
                  <StatusBadge status={thread.status} />
                  {thread.ownerName ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <User size={12} />
                      {thread.ownerName}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">Unassigned</span>
                  )}
                </div>

                {/* SLA indicator */}
                <div className="flex-shrink-0 w-28 text-right">
                  {mostUrgentSla !== undefined && (
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${getSlaBadgeClass(mostUrgentSla)}`}
                    >
                      {isBreaching ? "⚠ " : ""}
                      {formatSlaRemaining(mostUrgentSla)}
                    </span>
                  )}
                </div>
              </div>

              {/* Mobile layout */}
              <div className="sm:hidden space-y-2">
                <div className="flex items-start gap-2">
                  <SourceIcon
                    size={16}
                    className={`mt-0.5 flex-shrink-0 ${thread.source === "email" ? "text-primary" : "text-purple-500"}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <PriorityBadge priority={thread.priority} />
                      <span className="text-sm font-medium text-foreground truncate">
                        {thread.subject}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <StatusBadge status={thread.status} />
                    {thread.ownerName ? (
                      <span className="flex items-center gap-1">
                        <User size={11} />
                        {thread.ownerName}
                      </span>
                    ) : (
                      <span className="italic">Unassigned</span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock size={11} />
                      {getAgeLabel(thread.lastMessageAt)}
                    </span>
                  </div>
                  {mostUrgentSla !== undefined && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${getSlaBadgeClass(mostUrgentSla)}`}
                    >
                      {isBreaching ? "⚠ " : ""}
                      {formatSlaRemaining(mostUrgentSla)}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
