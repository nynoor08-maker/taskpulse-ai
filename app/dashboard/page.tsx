"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/client";

type Task = {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  payment_status: "unpaid" | "paid";
  call_logs: Array<{ agreed_price: number | null }>;
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

  useEffect(() => {
    let isActive = true;

    async function loadTasks() {
      let supabase;
      try {
        supabase = createClient();
      } catch (configurationError) {
        if (isActive) {
          setError(
            configurationError instanceof Error
              ? configurationError.message
              : "Supabase configuration is incomplete.",
          );
        }
        return;
      }

      const { data, error: queryError } = await supabase
        .from("tasks")
        .select("id, title, status, payment_status, call_logs(agreed_price)")
        .in("status", ["pending", "in_progress", "completed", "failed"])
        .order("created_at", { ascending: false });

      if (!isActive) return;
      if (queryError) {
        setError(queryError.message);
        return;
      }

      setTasks((data ?? []) as Task[]);
    }

    void loadTasks();
    return () => {
      isActive = false;
    };
  }, []);

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
        Track negotiation progress and pay confirmed vendor quotes.
      </p>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      <div className="mt-6 space-y-4">
        {tasks.length === 0 && !error ? (
          <p className="rounded-xl border bg-white p-5 text-sm text-slate-600">
            No tasks yet. Create one through the API or an inbound call.
          </p>
        ) : null}
        {tasks.map((task) => {
          const agreedPrice = Array.isArray(task.call_logs)
            ? task.call_logs[0]?.agreed_price
            : null;
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
