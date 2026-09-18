"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/client";
import { Alert, PageHeader } from "@/components/ui-kit";

type Vendor = {
  id: string;
  business_name: string;
  phone_number: string;
  hourly_rate: number;
  is_accepting_jobs: boolean;
};

export default function VendorPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [email, setEmail] = useState("");

  const loadVendors = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error: queryError } = await supabase
        .from("vendors")
        .select("id, business_name, phone_number, hourly_rate, is_accepting_jobs")
        .order("created_at", { ascending: false });
      if (queryError) {
        setError(queryError.message);
        setLoading(false);
        return;
      }
      setVendors(data ?? []);
      setLoading(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load vendors.");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void loadVendors();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loadVendors]);

  async function createProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/vendor/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName,
          phoneNumber,
          hourlyRate: Number(hourlyRate),
          email: email.trim() || undefined,
        }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          data &&
          typeof data === "object" &&
          typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Unable to create vendor profile.";
        throw new Error(message);
      }
      setBusinessName("");
      setPhoneNumber("");
      setHourlyRate("");
      setEmail("");
      await loadVendors();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create vendor profile.");
    } finally {
      setCreating(false);
    }
  }

  async function toggleAccepting(vendor: Vendor) {
    setBusyId(vendor.id);
    setError("");
    const supabase = createClient();
    const next = !vendor.is_accepting_jobs;
    const { error: updateError } = await supabase
      .from("vendors")
      .update({ is_accepting_jobs: next })
      .eq("id", vendor.id);
    if (updateError) {
      setError(updateError.message);
      setBusyId(null);
      return;
    }
    setVendors((current) =>
      current.map((row) =>
        row.id === vendor.id ? { ...row, is_accepting_jobs: next } : row,
      ),
    );
    setBusyId(null);
  }

  return (
    <main className="mx-auto min-h-[calc(100vh-3.5rem)] max-w-3xl px-6 py-10 sm:py-12">
      <PageHeader
        eyebrow="Vendor"
        title="Workspace"
        description="Register your trade, control job intake, and answer fallback quote links when a live call is missed."
      />

      {error ? (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      {loading ? (
        <div className="tp-surface mt-8 space-y-3 p-6">
          <div className="h-4 w-1/2 animate-pulse rounded bg-mist" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-mist" />
        </div>
      ) : null}

      {!loading && vendors.length === 0 ? (
        <form className="tp-surface mt-8 space-y-4 p-6" onSubmit={(event) => void createProfile(event)}>
          <h2 className="font-heading text-xl text-ink">Create your vendor profile</h2>
          <p className="text-sm text-muted-foreground">
            This phone number is how TaskPulse matches fallback quote SMS and inbound dispatch.
          </p>
          <label className="tp-label">
            Business name
            <input
              className="tp-input"
              onChange={(event) => setBusinessName(event.target.value)}
              placeholder="Northside Plumbing Co."
              required
              value={businessName}
            />
          </label>
          <label className="tp-label">
            Business phone (E.164)
            <input
              className="tp-input"
              onChange={(event) => setPhoneNumber(event.target.value)}
              placeholder="+15551234567"
              required
              type="tel"
              value={phoneNumber}
            />
          </label>
          <label className="tp-label">
            Hourly rate (USD)
            <input
              className="tp-input"
              inputMode="decimal"
              min="0"
              onChange={(event) => setHourlyRate(event.target.value)}
              placeholder="95"
              required
              step="0.01"
              type="number"
              value={hourlyRate}
            />
          </label>
          <label className="tp-label">
            Email for quote requests (optional)
            <input
              className="tp-input"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="jobs@northside.plumbing"
              type="email"
              value={email}
            />
          </label>
          <button className="tp-btn-primary" disabled={creating} type="submit">
            {creating ? "Creating…" : "Create vendor profile"}
          </button>
        </form>
      ) : null}

      <div className="mt-8 space-y-4">
        {vendors.map((vendor) => (
          <article className="tp-surface p-6" key={vendor.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-heading text-xl text-ink">{vendor.business_name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {vendor.phone_number} · ${Number(vendor.hourly_rate).toFixed(2)}/hour
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
                  vendor.is_accepting_jobs
                    ? "bg-pulse-soft text-[#0b3d36]"
                    : "bg-mist text-muted-foreground"
                }`}
              >
                {vendor.is_accepting_jobs ? "Accepting jobs" : "Paused"}
              </span>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                className="tp-btn-secondary"
                disabled={busyId === vendor.id}
                onClick={() => void toggleAccepting(vendor)}
                type="button"
              >
                {vendor.is_accepting_jobs ? "Pause new jobs" : "Start accepting jobs"}
              </button>
              <Link className="tp-btn-secondary" href="/vendor/quote">
                Open quote form
              </Link>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
