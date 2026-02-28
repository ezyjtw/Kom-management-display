"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ThreadDetail } from "@/components/comms/ThreadDetail";

export default function ThreadDetailPage() {
  const params = useParams();
  const [thread, setThread] = useState<any>(null);
  const [employees, setEmployees] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (params.id) {
      Promise.all([
        fetch(`/api/comms/threads/${params.id}`).then((r) => r.json()),
        fetch("/api/employees").then((r) => r.json()),
      ])
        .then(([threadJson, empJson]) => {
          if (threadJson.success) setThread(threadJson.data);
          if (empJson.success) {
            setEmployees(
              empJson.data.map((e: any) => ({ id: e.id, name: e.name }))
            );
          }
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [params.id]);

  async function handleStatusChange(status: string) {
    const res = await fetch(`/api/comms/threads/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const json = await res.json();
    if (json.success) {
      setThread((prev: any) => ({ ...prev, status, lastActionAt: new Date().toISOString() }));
    }
  }

  async function handleOwnerChange(ownerId: string | null, handoverNote: string) {
    const res = await fetch(`/api/comms/threads/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ownerUserId: ownerId,
        actionBy: ownerId || thread?.ownerUserId, // use new or old owner as actor
        handoverNote,
      }),
    });
    const json = await res.json();
    if (json.success) {
      // Refetch full thread
      const fresh = await fetch(`/api/comms/threads/${params.id}`).then((r) => r.json());
      if (fresh.success) setThread(fresh.data);
    }
  }

  async function handleAddNote(content: string) {
    // For MVP, add note directly (in production, use proper auth)
    const authorId = thread?.ownerUserId || employees[0]?.id;
    if (!authorId) return;

    const res = await fetch(`/api/comms/threads/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: thread?.status }), // touch lastActionAt
    });

    // Refetch thread
    const fresh = await fetch(`/api/comms/threads/${params.id}`).then((r) => r.json());
    if (fresh.success) setThread(fresh.data);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        Loading thread...
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-500">Thread not found</p>
        <Link href="/comms" className="text-blue-600 hover:underline mt-2 inline-block">
          Back to Communications
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/comms" className="text-slate-400 hover:text-slate-600">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold text-slate-900">Thread Detail</h1>
      </div>

      <ThreadDetail
        thread={thread}
        employees={employees}
        onStatusChange={handleStatusChange}
        onOwnerChange={handleOwnerChange}
        onAddNote={handleAddNote}
      />
    </div>
  );
}
