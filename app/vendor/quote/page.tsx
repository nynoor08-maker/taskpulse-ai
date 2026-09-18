"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type TaskSummary = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  target_vendor_phone: string | null;
};

function QuoteForm() {
  const searchParams = useSearchParams();
  const taskId = searchParams.get("taskId") ?? "";
  const [task, setTask] = useState<TaskSummary | null>(null);
  const [quotedPrice, setQuotedPrice] = useState("");
  const [availableTime, setAvailableTime] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(Boolean(taskId));

  useEffect(() => {
    if (!taskId) return;

    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/vendor/quotes?taskId=${encodeURIComponent(taskId)}`, {
        cache: "no-store",
      });
      const data: unknown = await response.json().catch(() => null);
      if (cancelled) return;
      if (!response.ok) {
        const message =
          data &&
          typeof data === "object" &&
          typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Unable to load quote request.";
        setError(message);
        setLoading(false);
        return;
      }
      if (
        !data ||
        typeof data !== "object" ||
        typeof (data as { task?: unknown }).task !== "object" ||
        (data as { task: unknown }).task === null
      ) {
        setError("Task not found.");
        setLoading(false);
        return;
      }
      setTask((data as { task: TaskSummary }).task);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [taskId]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const price = Number(quotedPrice);
    try {
      const response = await fetch("/api/vendor/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          quotedPrice: price,
          availableTime,
          notes: notes.trim() || undefined,
        }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          data &&
          typeof data === "object" &&
          typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Unable to submit quote.";
        throw new Error(message);
      }
      setSuccess(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to submit quote.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!taskId) {
    return (
      <div className="space-y-3">
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          A taskId query parameter is required.
        </p>
        <Link className="text-sm font-medium text-slate-800 underline" href="/vendor">
          Back to vendor workspace
        </Link>
      </div>
    );
  }

  if (loading) {
    return <p className="text-sm text-slate-600">Loading quote request…</p>;
  }

  if (success) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900">
        <p className="font-medium">Quote submitted.</p>
        <p className="mt-2">The customer has been notified and can pay from their dashboard.</p>
        <Link className="mt-4 inline-block font-medium underline" href="/vendor">
          Back to vendor workspace
        </Link>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="space-y-3">
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>
        <Link className="text-sm font-medium text-slate-800 underline" href="/login">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
      <article className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-medium">{task.title}</h2>
        {task.description && <p className="mt-2 text-sm text-slate-600">{task.description}</p>}
        <p className="mt-3 text-xs uppercase tracking-wide text-slate-500">Status: {task.status}</p>
      </article>
      {error && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <label className="block text-sm font-medium text-slate-800">
        Quoted price (USD)
        <input
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          inputMode="decimal"
          min="0.01"
          onChange={(event) => setQuotedPrice(event.target.value)}
          required
          step="0.01"
          type="number"
          value={quotedPrice}
        />
      </label>
      <label className="block text-sm font-medium text-slate-800">
        Arrival window
        <input
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          onChange={(event) => setAvailableTime(event.target.value)}
          placeholder="e.g. 2:00 PM – 4:00 PM today"
          required
          type="text"
          value={availableTime}
        />
      </label>
      <label className="block text-sm font-medium text-slate-800">
        Notes (optional)
        <textarea
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          value={notes}
        />
      </label>
      <button
        className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        disabled={submitting || task.status === "completed"}
        type="submit"
      >
        {submitting ? "Submitting…" : "Submit quote"}
      </button>
    </form>
  );
}

export default function VendorQuotePage() {
  return (
    <main className="mx-auto min-h-screen max-w-xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Submit a quote</h1>
      <p className="mt-2 text-slate-600">
        Respond to a TaskPulse service request after a missed or failed negotiation call.
      </p>
      <div className="mt-8">
        <Suspense fallback={<p className="text-sm text-slate-600">Loading…</p>}>
          <QuoteForm />
        </Suspense>
      </div>
    </main>
  );
}
