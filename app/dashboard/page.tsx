"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { createClient } from "@/client";
import { pickAgreedPrice } from "@/lib/pick-agreed-price";
import { Alert, EmptyState, PageHeader, StatusBadge } from "@/components/ui-kit";

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
  const [loading, setLoading] = useState(true);
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
      setLoading(false);
      return;
    }

    const { data, error: queryError } = await supabase
      .from("tasks")
      .select("id, title, status, payment_status, call_logs(agreed_price, created_at)")
      .in("status", ["pending", "in_progress", "completed", "failed"])
      .order("created_at", { ascending: false });

    if (queryError) {
      setError(queryError.message);
      setLoading(false);
      return;
    }

    setTasks((data ?? []) as Task[]);
    setLoading(false);
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
    <main className="mx-auto min-h-[calc(100vh-3.5rem)] max-w-3xl px-6 py-10 sm:py-12">
      <PageHeader
        eyebrow="Customer"
        title="Your jobs"
        description="Describe the work, dispatch the negotiation squad, and pay when a quote lands."
      />

      <form className="tp-surface mt-8 space-y-4 p-6" onSubmit={(event) => void createTask(event)}>
        <h2 className="font-heading text-xl text-ink">New service request</h2>
        <label className="tp-label">
          Vendor phone (E.164)
          <input
            className="tp-input"
            onChange={(event) => setVendorPhone(event.target.value)}
            placeholder="+15551234567"
            required
            type="tel"
            value={vendorPhone}
          />
        </label>
        <label className="tp-label">
          What needs doing?
          <textarea
            className="tp-input min-h-[96px] resize-y"
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Clogged kitchen sink — need same-day visit"
            required
            rows={3}
            value={description}
          />
        </label>
        <label className="tp-label">
          Max budget (USD, optional)
          <input
            className="tp-input"
            inputMode="decimal"
            min="0"
            onChange={(event) => setMaxBudget(event.target.value)}
            placeholder="250"
            step="0.01"
            type="number"
            value={maxBudget}
          />
        </label>
        <label className="flex items-center gap-2.5 text-sm text-ink">
          <input
            checked={dispatchNow}
            className="size-4 rounded border-border accent-[var(--pulse)]"
            onChange={(event) => setDispatchNow(event.target.checked)}
            type="checkbox"
          />
          Start Triage → Negotiator → Closing call now
        </label>
        <button className="tp-btn-primary" disabled={creating} type="submit">
          {creating ? "Creating…" : dispatchNow ? "Create & dispatch" : "Save without calling"}
        </button>
      </form>

      {error ? (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      <section className="mt-10 space-y-4">
        <h2 className="font-heading text-xl text-ink">Activity</h2>
        {loading ? (
          <div className="tp-surface space-y-3 p-6">
            <div className="h-4 w-2/3 animate-pulse rounded bg-mist" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-mist" />
          </div>
        ) : null}
        {!loading && tasks.length === 0 && !error ? (
          <EmptyState
            title="No jobs yet"
            body="Submit a request above. TaskPulse will call the vendor, negotiate, and bring a quote back here."
          />
        ) : null}
        {tasks.map((task) => {
          const agreedPrice = pickAgreedPrice(task.call_logs);
          const canPay =
            task.status === "completed" &&
            task.payment_status === "unpaid" &&
            typeof agreedPrice === "number" &&
            agreedPrice > 0;

          return (
            <article key={task.id} className="tp-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="text-base font-semibold text-ink">{task.title}</h3>
                <StatusBadge status={task.status} />
              </div>
              {task.payment_status === "paid" ? (
                <p className="mt-3 text-sm font-medium text-emerald-700">Paid · booking confirmed</p>
              ) : canPay ? (
                <button
                  type="button"
                  className="tp-btn-primary mt-4"
                  disabled={payingTaskId === task.id}
                  onClick={() => void beginCheckout(task, agreedPrice)}
                >
                  {payingTaskId === task.id
                    ? "Opening checkout…"
                    : `Pay & confirm (${formatPrice(agreedPrice)})`}
                </button>
              ) : task.status === "completed" ? (
                <p className="mt-3 text-sm text-muted-foreground">No agreed quote available yet.</p>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  {task.status === "in_progress"
                    ? "Squad is negotiating with the vendor."
                    : task.status === "failed"
                      ? "Call failed — a backup vendor may still send a quote."
                      : "Waiting to dispatch."}
                </p>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}
