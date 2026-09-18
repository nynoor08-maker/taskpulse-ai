"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/client";
import { Alert, PageHeader } from "@/components/ui-kit";

type CallLog = {
  id: string;
  vapi_call_id: string | null;
  call_duration: number | null;
  status: string | null;
  created_at: string;
  tasks: Array<{ target_vendor_phone: string | null }> | { target_vendor_phone: string | null } | null;
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
  return <span className="tabular-nums">{formatDuration(elapsed)}</span>;
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
    { label: "Tasks dispatched", value: metrics.totalTasks.toLocaleString() },
    { label: "Completion rate", value: `${metrics.completionRate.toFixed(1)}%` },
    { label: "Avg. savings", value: formatCurrency(metrics.averageSavings) },
    { label: "Platform volume", value: formatCurrency(metrics.platformVolume) },
  ];

  return (
    <main className="mx-auto min-h-[calc(100vh-3.5rem)] max-w-6xl px-6 py-10 sm:py-12">
      <PageHeader
        eyebrow="Operations"
        title="Live monitor"
        description="Watch active negotiations and pause outbound dispatch if something goes wrong."
        action={
          <button
            type="button"
            role="switch"
            aria-checked={dispatchPaused}
            disabled={isUpdatingPause}
            onClick={() => void updateDispatchPause()}
            className={dispatchPaused ? "tp-btn-danger" : "tp-btn-primary"}
          >
            {isUpdatingPause
              ? "Updating…"
              : dispatchPaused
                ? "Emergency pause active"
                : "Pause all dispatches"}
          </button>
        }
      />

      {error ? (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <article key={card.label} className="tp-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {card.label}
            </p>
            <p className="mt-3 font-heading text-3xl tracking-tight text-ink">{card.value}</p>
          </article>
        ))}
      </section>

      <section className="mt-10">
        <h2 className="font-heading text-xl text-ink">Voice call feed</h2>
        <div className="tp-surface mt-4 overflow-hidden">
          {visibleCalls.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No recent calls to display.</p>
          ) : (
            <ul className="divide-y divide-border">
              {visibleCalls.map((call) => {
                const task = Array.isArray(call.tasks) ? call.tasks[0] : call.tasks;
                return (
                  <li
                    key={call.id}
                    className="grid gap-2 px-5 py-4 text-sm sm:grid-cols-4 sm:items-center"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {call.vapi_call_id ?? "Awaiting Vapi call ID"}
                    </span>
                    <span className="text-ink">{task?.target_vendor_phone ?? "Unknown target"}</span>
                    <CallDuration call={call} />
                    <span
                      className={`font-semibold ${
                        call.status === "in_progress" ? "text-pulse" : "text-muted-foreground"
                      }`}
                    >
                      {call.status === "in_progress" ? "in progress" : call.status ?? "ended"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
