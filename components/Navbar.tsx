"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ensureBrowserProfile, type ProfileSummary } from "@/lib/ensure-profile-browser";

export function Navbar() {
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      setLoaded(true);
      return;
    }
    void ensureBrowserProfile()
      .then((next) => setProfile(next))
      .catch(() => null)
      .finally(() => setLoaded(true));
  }, []);

  const isAdmin = Boolean(profile && (profile.is_admin || profile.role === "admin"));
  const mainHref = profile?.role === "vendor" ? "/vendor" : "/dashboard";
  const mainLabel = profile?.role === "vendor" ? "Vendor workspace" : "Dashboard";

  return (
    <nav className="border-b border-slate-200/80 bg-white/90 px-6 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-5 text-sm">
        <Link className="font-semibold tracking-tight text-slate-900" href="/">
          TaskPulse AI
        </Link>
        {loaded && profile && (
          <>
            <Link className="text-slate-600 hover:text-slate-900" href={mainHref}>
              {mainLabel}
            </Link>
            {isAdmin && (
              <Link className="text-slate-600 hover:text-slate-900" href="/admin">
                Operations
              </Link>
            )}
          </>
        )}
        {loaded && !profile && (
          <Link className="ml-auto text-slate-600 hover:text-slate-900" href="/login">
            Sign in
          </Link>
        )}
      </div>
    </nav>
  );
}
