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

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-10">
      <h1 className="text-3xl font-semibold">Vendor workspace</h1>
      <p className="mt-2 text-slate-600">Manage your service profiles and availability.</p>
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
              <p className="mt-1 text-sm text-slate-600">{vendor.phone_number} · ${Number(vendor.hourly_rate).toFixed(2)}/hour</p>
              <p className={`mt-3 text-sm font-medium ${vendor.is_accepting_jobs ? "text-emerald-700" : "text-slate-600"}`}>
                {vendor.is_accepting_jobs ? "Accepting jobs" : "Not accepting jobs"}
              </p>
            </article>
          ))
        )}
      </div>
    </main>
  );
}
