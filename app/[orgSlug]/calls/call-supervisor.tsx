"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, EmptyState, PageHeader } from "@/components/ui-kit";

type ActiveCall = {
  id: string;
  vapi_call_id: string | null;
  created_at: string;
  tasks: { title: string; target_vendor_phone: string | null } | null;
};

export function CallSupervisor({
  initialCalls,
  orgSlug,
}: {
  initialCalls: ActiveCall[];
  orgSlug: string;
}) {
  const [calls, setCalls] = useState(initialCalls);
  const [error, setError] = useState("");
  const [busyCallId, setBusyCallId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/organizations/${orgSlug}/calls`, { cache: "no-store" });
    const data: unknown = await response.json();
    if (
      response.ok &&
      data &&
      typeof data === "object" &&
      Array.isArray((data as { calls?: unknown }).calls)
    ) {
      setCalls((data as { calls: ActiveCall[] }).calls);
    }
  }, [orgSlug]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refresh();
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  async function intervene(callId: string, action: string) {
    setBusyCallId(callId);
    setError("");
    const response = await fetch(`/api/organizations/${orgSlug}/calls/${callId}/interventions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!response.ok) {
      const data: unknown = await response.json();
      setError(
        data &&
          typeof data === "object" &&
          typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : "Unable to control call.",
      );
    }
    setBusyCallId(null);
    await refresh();
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 sm:py-12">
      <PageHeader
        eyebrow="Supervisor"
        title="Live calls"
        description="Refreshes every 10 seconds. Takeover transfers the vendor to the phone number on your profile."
      />
      {error ? (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      <div className="mt-8 space-y-4">
        {calls.length === 0 ? (
          <EmptyState title="No active calls" body="When a squad dial is in progress, it will appear here." />
        ) : (
          calls.map((call) => (
            <section className="tp-surface p-5" key={call.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="font-heading text-xl text-ink">
                    {call.tasks?.title ?? "Untitled task"}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {call.tasks?.target_vendor_phone ?? "Unknown vendor"} · Started{" "}
                    {new Date(call.created_at).toLocaleTimeString()}
                  </p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {call.vapi_call_id ?? "Vapi call ID pending"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="tp-btn-secondary"
                    disabled={busyCallId === call.id}
                    onClick={() => void intervene(call.id, "mute_assistant")}
                    type="button"
                  >
                    Mute agent
                  </button>
                  <button
                    className="tp-btn-secondary"
                    disabled={busyCallId === call.id}
                    onClick={() => void intervene(call.id, "unmute_assistant")}
                    type="button"
                  >
                    Unmute
                  </button>
                  <button
                    className="tp-btn-primary"
                    disabled={busyCallId === call.id}
                    onClick={() => void intervene(call.id, "takeover")}
                    type="button"
                  >
                    Take over
                  </button>
                  <button
                    className="tp-btn-danger"
                    disabled={busyCallId === call.id}
                    onClick={() => void intervene(call.id, "end_call")}
                    type="button"
                  >
                    End call
                  </button>
                </div>
              </div>
            </section>
          ))
        )}
      </div>
    </main>
  );
}
