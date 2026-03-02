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
    // Server derives actor from session — no client-side identity needed
    const res = await fetch(`/api/comms/threads/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ownerUserId: ownerId,
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
    if (!content.trim()) return;

    // Server derives author from session — no client-side userId needed
    await fetch(`/api/comms/threads/${params.id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    // Refetch thread to show new note
    const fresh = await fetch(`/api/comms/threads/${params.id}`).then((r) => r.json());
    if (fresh.success) setThread(fresh.data);
  }

  async function handleSecondaryAdd(employeeId: string) {
    const res = await fetch(`/api/comms/threads/${params.id}/secondaries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, action: "add" }),
    });
    const json = await res.json();
    if (json.success) {
      // Refetch full thread
      const fresh = await fetch(`/api/comms/threads/${params.id}`).then((r) => r.json());
      if (fresh.success) setThread(fresh.data);
    }
  }

  async function handleSecondaryRemove(employeeId: string) {
    const res = await fetch(`/api/comms/threads/${params.id}/secondaries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, action: "remove" }),
    });
    const json = await res.json();
    if (json.success) {
      const fresh = await fetch(`/api/comms/threads/${params.id}`).then((r) => r.json());
      if (fresh.success) setThread(fresh.data);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Loading thread...
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Thread not found</p>
        <Link href="/comms" className="text-primary hover:underline mt-2 inline-block">
          Back to Communications
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/comms" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold text-foreground">Thread Detail</h1>
      </div>

      <ThreadDetail
        thread={thread}
        employees={employees}
        onStatusChange={handleStatusChange}
        onOwnerChange={handleOwnerChange}
        onAddNote={handleAddNote}
        onSecondaryAdd={handleSecondaryAdd}
        onSecondaryRemove={handleSecondaryRemove}
      />
    </div>
  );
}
