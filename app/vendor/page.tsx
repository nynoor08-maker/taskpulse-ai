"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/client";

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
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void supabase
      .from("vendors")
      .select("id, business_name, phone_number, hourly_rate, is_accepting_jobs")
      .order("created_at", { ascending: false })
      .then(({ data, error: queryError }) => {
        if (queryError) {
          setError(queryError.message);
          return;
        }
        setVendors(data ?? []);
      });
  }, []);

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
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Vendor workspace</h1>
      <p className="mt-2 text-slate-600">
        Manage availability. Fallback quote links from missed calls open at{" "}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">/vendor/quote</code>.
      </p>
      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
      <div className="mt-6 space-y-4">
        {vendors.length === 0 ? (
          <p className="rounded-xl border bg-white p-5 text-sm text-slate-600">
            No vendor profile has been created for this account.
          </p>
        ) : (
          vendors.map((vendor) => (
            <article className="rounded-xl border bg-white p-5 shadow-sm" key={vendor.id}>
              <h2 className="font-medium">{vendor.business_name}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {vendor.phone_number} · ${Number(vendor.hourly_rate).toFixed(2)}/hour
              </p>
              <p
                className={`mt-3 text-sm font-medium ${vendor.is_accepting_jobs ? "text-emerald-700" : "text-slate-600"}`}
              >
                {vendor.is_accepting_jobs ? "Accepting jobs" : "Not accepting jobs"}
              </p>
              <button
                className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 disabled:opacity-50"
                disabled={busyId === vendor.id}
                onClick={() => void toggleAccepting(vendor)}
                type="button"
              >
                {vendor.is_accepting_jobs ? "Pause new jobs" : "Start accepting jobs"}
              </button>
            </article>
          ))
        )}
      </div>
    </main>
  );
}
