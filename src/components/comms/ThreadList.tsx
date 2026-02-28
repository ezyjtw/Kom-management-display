"use client";

import Link from "next/link";
import { Mail, MessageCircle, Clock, User } from "lucide-react";
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
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
        <MessageCircle size={32} className="mx-auto text-slate-300 mb-3" />
        <p className="text-slate-500">No threads matching your filters</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="divide-y divide-slate-100">
        {threads.map((thread) => {
          const SourceIcon = thread.source === "email" ? Mail : MessageCircle;
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
              className={`flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors ${
                isBreaching ? "bg-red-50/50" : ""
              }`}
            >
              {/* Source icon */}
              <div className="flex-shrink-0">
                <SourceIcon
                  size={18}
                  className={thread.source === "email" ? "text-blue-500" : "text-purple-500"}
                />
              </div>

              {/* Main content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <PriorityBadge priority={thread.priority} />
                  <span className="text-sm font-medium text-slate-900 truncate">
                    {thread.subject}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  {thread.clientOrPartnerTag && (
                    <span className="bg-slate-100 px-1.5 py-0.5 rounded">
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
                  <span className="flex items-center gap-1 text-xs text-slate-600">
                    <User size={12} />
                    {thread.ownerName}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400 italic">Unassigned</span>
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
            </Link>
          );
        })}
      </div>
    </div>
  );
}
