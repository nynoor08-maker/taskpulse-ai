"use client";

import { useCallback, useEffect, useState } from "react";

type ActiveCall = {
  id: string;
  vapi_call_id: string | null;
  created_at: string;
  tasks: { title: string; target_vendor_phone: string | null } | null;
};

export function CallSupervisor({ initialCalls, orgSlug }: { initialCalls: ActiveCall[]; orgSlug: string }) {
  const [calls, setCalls] = useState(initialCalls);
  const [error, setError] = useState("");
  const [busyCallId, setBusyCallId] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const response = await fetch(`/api/organizations/${orgSlug}/calls`, { cache: "no-store" });
    const data: unknown = await response.json();
    if (response.ok && data && typeof data === "object" && Array.isArray((data as { calls?: unknown }).calls)) {
      setCalls((data as { calls: ActiveCall[] }).calls);
    }
  }, [orgSlug]);
  useEffect(() => {
    const interval = window.setInterval(() => { void refresh(); }, 10_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  async function intervene(callId: string, action: string) {
    setBusyCallId(callId); setError("");
    const response = await fetch(`/api/organizations/${orgSlug}/calls/${callId}/interventions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
    });
    if (!response.ok) {
      const data: unknown = await response.json();
      setError(data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : "Unable to control call.");
    }
    setBusyCallId(null);
    await refresh();
  }

  return <main className="mx-auto max-w-5xl px-6 py-10">
    <h1 className="text-2xl font-semibold">Live call supervisor</h1>
    <p className="mt-2 text-sm text-slate-600">Calls refresh every 10 seconds. Takeover transfers the live vendor call to the phone number on your profile.</p>
    {error && <p className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="mt-6 space-y-4">{calls.length === 0 ? <p className="rounded border p-5 text-sm text-slate-600">No active calls.</p> : calls.map((call) => <section className="rounded border bg-white p-5" key={call.id}>
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold">{call.tasks?.title ?? "Untitled task"}</h2><p className="mt-1 text-sm text-slate-600">{call.tasks?.target_vendor_phone ?? "Unknown vendor"} · Started {new Date(call.created_at).toLocaleTimeString()}</p><p className="mt-1 font-mono text-xs text-slate-500">{call.vapi_call_id ?? "Vapi call ID pending"}</p></div><div className="flex flex-wrap gap-2"><button className="rounded border px-3 py-2 text-sm" disabled={busyCallId === call.id} onClick={() => void intervene(call.id, "mute_assistant")} type="button">Mute agent</button><button className="rounded border px-3 py-2 text-sm" disabled={busyCallId === call.id} onClick={() => void intervene(call.id, "unmute_assistant")} type="button">Unmute</button><button className="rounded bg-amber-600 px-3 py-2 text-sm font-medium text-white" disabled={busyCallId === call.id} onClick={() => void intervene(call.id, "takeover")} type="button">Take over</button><button className="rounded bg-red-700 px-3 py-2 text-sm font-medium text-white" disabled={busyCallId === call.id} onClick={() => void intervene(call.id, "end_call")} type="button">End call</button></div></div>
    </section>)}</div>
  </main>;
}
