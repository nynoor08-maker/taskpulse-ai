"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/client";

type CallLog = {
  id: string;
  vapi_call_id: string | null;
  call_duration: number | null;
  status: string | null;
  created_at: string;
  tasks: Array<{ target_vendor_phone: string | null }>;
};

type Metrics = {
  totalTasks: number;
  completionRate: number;
  averageSavings: number;
  platformVolume: number;
};

type AdminMonitorProps = {
  initialCalls: CallLog[];
  dispatchPaused: boolean;
  metrics: Metrics;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function CallDuration({ call }: { call: CallLog }) {
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (call.status !== "in_progress" || call.call_duration != null) return;

    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [call.call_duration, call.status]);

  const elapsed =
    call.call_duration ??
    Math.max(0, Math.floor((now - Date.parse(call.created_at)) / 1_000));
  return <span>{formatDuration(elapsed)}</span>;
}

export function AdminMonitor({
  initialCalls,
  dispatchPaused: initialDispatchPaused,
  metrics,
}: AdminMonitorProps) {
  const [calls, setCalls] = useState(initialCalls);
  const [dispatchPaused, setDispatchPaused] = useState(initialDispatchPaused);
  const [isUpdatingPause, setIsUpdatingPause] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("admin-live-calls")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "call_logs" },
        (payload) => {
          const call = payload.new as CallLog;
          setCalls((current) => {
            const withoutCurrent = current.filter((item) => item.id !== call.id);
            return [call, ...withoutCurrent].slice(0, 20);
          });
        },
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setError("Live call updates are unavailable. Refresh to retry.");
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const visibleCalls = useMemo(
    () =>
      calls.filter(
        (call) =>
          call.status === "in_progress" ||
          call.status === "completed" ||
          call.status === "failed",
      ),
    [calls],
  );

  async function updateDispatchPause() {
    const nextValue = !dispatchPaused;
    setError("");
    setIsUpdatingPause(true);

    try {
      const response = await fetch("/api/admin/dispatch-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dispatchPaused: nextValue }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof data === "object" &&
          data !== null &&
          typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Unable to update dispatch settings.";
        throw new Error(message);
      }

      setDispatchPaused(nextValue);
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Unable to update dispatch settings.",
      );
    } finally {
      setIsUpdatingPause(false);
    }
  }

  const cards = [
    { label: "Total tasks dispatched", value: metrics.totalTasks.toLocaleString() },
    { label: "Call completion rate", value: `${metrics.completionRate.toFixed(1)}%` },
    { label: "Average negotiation savings", value: formatCurrency(metrics.averageSavings) },
    { label: "Total platform volume", value: formatCurrency(metrics.platformVolume) },
  ];

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-10">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Operations
          </p>
          <h1 className="text-3xl font-semibold">Admin monitoring</h1>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={dispatchPaused}
          disabled={isUpdatingPause}
          onClick={() => void updateDispatchPause()}
          className={[
            "rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50",
            dispatchPaused ? "bg-red-700" : "bg-slate-900",
          ].join(" ")}
        >
          {isUpdatingPause
            ? "Updating dispatches..."
            : dispatchPaused
              ? "Emergency Pause Active"
              : "Emergency Pause All Dispatches"}
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <article key={card.label} className="rounded-xl border bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-600">{card.label}</p>
            <p className="mt-2 text-2xl font-semibold">{card.value}</p>
          </article>
        ))}
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Live voice call feed</h2>
        <div className="mt-4 overflow-hidden rounded-xl border bg-white">
          {visibleCalls.length === 0 ? (
            <p className="p-6 text-sm text-slate-600">No recent calls to display.</p>
          ) : (
            <ul className="divide-y">
              {visibleCalls.map((call) => (
                <li key={call.id} className="grid gap-2 p-4 text-sm sm:grid-cols-4">
                  <span className="font-mono text-xs">
                    {call.vapi_call_id ?? "Awaiting Vapi call ID"}
                  </span>
                  <span>{call.tasks[0]?.target_vendor_phone ?? "Unknown target"}</span>
                  <CallDuration call={call} />
                  <span className="font-medium">
                    {call.status === "in_progress" ? "in progress" : "ended"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
