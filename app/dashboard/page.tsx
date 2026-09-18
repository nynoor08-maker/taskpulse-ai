"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { createClient } from "@/client";
import { pickAgreedPrice } from "@/lib/pick-agreed-price";

type Task = {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  payment_status: "unpaid" | "paid";
  call_logs: Array<{ agreed_price: number | null; created_at?: string }>;
};

function formatPrice(price: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(price);
}

export default function DashboardPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState("");
  const [payingTaskId, setPayingTaskId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [vendorPhone, setVendorPhone] = useState("");
  const [description, setDescription] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const [dispatchNow, setDispatchNow] = useState(true);

  const loadTasks = useCallback(async () => {
    let supabase;
    try {
      supabase = createClient();
    } catch (configurationError) {
      setError(
        configurationError instanceof Error
          ? configurationError.message
          : "Supabase configuration is incomplete.",
      );
      return;
    }

    const { data, error: queryError } = await supabase
      .from("tasks")
      .select("id, title, status, payment_status, call_logs(agreed_price, created_at)")
      .in("status", ["pending", "in_progress", "completed", "failed"])
      .order("created_at", { ascending: false });

    if (queryError) {
      setError(queryError.message);
      return;
    }

    setTasks((data ?? []) as Task[]);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void loadTasks();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loadTasks]);

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setCreating(true);
    try {
      const budgetValue = maxBudget.trim() === "" ? null : Number(maxBudget);
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorPhone,
          description,
          maxBudget: budgetValue,
          dispatch: dispatchNow,
        }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          data &&
          typeof data === "object" &&
          typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Unable to create task.";
        throw new Error(message);
      }
      setVendorPhone("");
      setDescription("");
      setMaxBudget("");
      await loadTasks();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create task.");
    } finally {
      setCreating(false);
    }
  }

  async function beginCheckout(task: Task, agreedPrice: number) {
    setError("");
    setPayingTaskId(task.id);

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          agreedPrice,
          vendorName: task.title,
        }),
      });
      const data: unknown = await response.json();

      if (
        !response.ok ||
        typeof data !== "object" ||
        data === null ||
        typeof (data as { url?: unknown }).url !== "string"
      ) {
        const message =
          typeof data === "object" &&
          data !== null &&
          typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Unable to start checkout.";
        throw new Error(message);
      }

      window.location.assign((data as { url: string }).url);
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Unable to start checkout.",
      );
      setPayingTaskId(null);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Your tasks</h1>
      <p className="mt-2 text-slate-600">
        Create a job, watch the squad negotiate, and pay confirmed quotes.
      </p>

      <form
        className="mt-8 space-y-4 rounded-xl border bg-white p-5 shadow-sm"
        onSubmit={(event) => void createTask(event)}
      >
        <h2 className="text-lg font-medium">New service request</h2>
        <label className="block text-sm font-medium text-slate-800">
          Vendor phone (E.164)
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            onChange={(event) => setVendorPhone(event.target.value)}
            placeholder="+15551234567"
            required
            type="tel"
            value={vendorPhone}
          />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          What needs doing?
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Clogged kitchen sink, need same-day visit"
            required
            rows={3}
            value={description}
          />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Max budget (USD, optional)
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            inputMode="decimal"
            min="0"
            onChange={(event) => setMaxBudget(event.target.value)}
            placeholder="250"
            step="0.01"
            type="number"
            value={maxBudget}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            checked={dispatchNow}
            onChange={(event) => setDispatchNow(event.target.checked)}
            type="checkbox"
          />
          Start Triage → Negotiator → Closing call now
        </label>
        <button
          className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          disabled={creating}
          type="submit"
        >
          {creating ? "Creating…" : dispatchNow ? "Create & dispatch" : "Create task"}
        </button>
      </form>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      <div className="mt-8 space-y-4">
        {tasks.length === 0 && !error ? (
          <p className="rounded-xl border bg-white p-5 text-sm text-slate-600">
            No tasks yet. Submit a request above to start.
          </p>
        ) : null}
        {tasks.map((task) => {
          const agreedPrice = pickAgreedPrice(task.call_logs);
          const canPay =
            task.status === "completed" &&
            task.payment_status === "unpaid" &&
            typeof agreedPrice === "number" &&
            agreedPrice > 0;

          return (
            <article key={task.id} className="rounded-xl border bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="font-medium">{task.title}</h2>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium uppercase tracking-wide text-slate-600">
                  {task.status.replaceAll("_", " ")}
                </span>
              </div>
              {task.payment_status === "paid" ? (
                <p className="mt-2 text-sm font-medium text-emerald-700">Paid</p>
              ) : canPay ? (
                <button
                  type="button"
                  className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={payingTaskId === task.id}
                  onClick={() => void beginCheckout(task, agreedPrice)}
                >
                  {payingTaskId === task.id
                    ? "Opening checkout..."
                    : `Pay & Confirm Booking (${formatPrice(agreedPrice)})`}
                </button>
              ) : task.status === "completed" ? (
                <p className="mt-2 text-sm text-slate-600">No agreed quote available.</p>
              ) : (
                <p className="mt-2 text-sm text-slate-600">
                  {task.status === "in_progress"
                    ? "Negotiation in progress."
                    : task.status === "failed"
                      ? "Dispatch failed — a backup vendor may still send a quote."
                      : "Waiting for dispatch."}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </main>
  );
}
