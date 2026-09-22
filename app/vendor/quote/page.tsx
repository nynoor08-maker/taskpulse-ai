"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Alert, PageHeader, StatusBadge } from "@/components/ui-kit";

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
      <div className="space-y-4">
        <Alert>
          Open this page from a TaskPulse SMS or email link that includes a taskId.
        </Alert>
        <Link className="tp-btn-secondary inline-flex" href="/vendor">
          Back to vendor workspace
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="tp-surface space-y-3 p-6">
        <div className="h-4 w-2/3 animate-pulse rounded bg-mist" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-mist" />
      </div>
    );
  }

  if (success) {
    return (
      <div className="tp-surface space-y-3 p-6">
        <Alert tone="success">Quote submitted. The customer can pay from their dashboard.</Alert>
        <Link className="tp-btn-secondary inline-flex" href="/vendor">
          Back to vendor workspace
        </Link>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="space-y-4">
        <Alert>{error || "Unable to load this quote request."}</Alert>
        <Link className="tp-btn-secondary inline-flex" href="/login">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
      <article className="tp-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="font-heading text-xl text-ink">{task.title}</h2>
          <StatusBadge status={task.status} />
        </div>
        {task.description ? (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{task.description}</p>
        ) : null}
      </article>
      {error ? <Alert>{error}</Alert> : null}
      <label className="tp-label">
        Quoted price (USD)
        <input
          className="tp-input"
          inputMode="decimal"
          min="0.01"
          onChange={(event) => setQuotedPrice(event.target.value)}
          required
          step="0.01"
          type="number"
          value={quotedPrice}
        />
      </label>
      <label className="tp-label">
        Arrival window
        <input
          className="tp-input"
          onChange={(event) => setAvailableTime(event.target.value)}
          placeholder="e.g. 2:00 PM – 4:00 PM today"
          required
          type="text"
          value={availableTime}
        />
      </label>
      <label className="tp-label">
        Notes (optional)
        <textarea
          className="tp-input min-h-[88px] resize-y"
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          value={notes}
        />
      </label>
      <button
        className="tp-btn-primary"
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
    <main className="mx-auto min-h-[calc(100vh-3.5rem)] max-w-xl px-6 py-10 sm:py-12">
      <PageHeader
        eyebrow="Vendor"
        title="Submit a quote"
        description="Respond after a missed negotiation call — price, window, done."
      />
      <div className="mt-8">
        <Suspense
          fallback={
            <div className="tp-surface space-y-3 p-6">
              <div className="h-4 w-2/3 animate-pulse rounded bg-mist" />
            </div>
          }
        >
          <QuoteForm />
        </Suspense>
      </div>
    </main>
  );
}
