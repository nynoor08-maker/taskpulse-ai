"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { ensureBrowserProfile, type ProfileSummary } from "@/lib/ensure-profile-browser";

const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

export function Navbar() {
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [loaded, setLoaded] = useState(!supabaseConfigured);

  useEffect(() => {
    if (!supabaseConfigured) return;
    let cancelled = false;
    void ensureBrowserProfile()
      .then((next) => {
        if (!cancelled) setProfile(next);
      })
      .catch(() => null)
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isAdmin = Boolean(profile && (profile.is_admin || profile.role === "admin"));
  const mainHref = profile?.role === "vendor" ? "/vendor" : "/dashboard";
  const mainLabel = profile?.role === "vendor" ? "Vendor" : "Dashboard";

  return (
    <nav className="sticky top-0 z-40 border-b border-border/70 bg-white/80 px-4 backdrop-blur-md sm:px-6">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 text-sm">
        <Link className="flex items-center gap-2.5 font-semibold tracking-tight text-ink" href="/">
          <BrandMark className="h-7 w-7" />
          <span className="font-heading text-lg">
            TaskPulse <span className="text-pulse">AI</span>
          </span>
        </Link>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {loaded && profile && (
            <>
              <Link
                className="rounded-lg px-3 py-1.5 text-muted-foreground transition hover:bg-mist hover:text-ink"
                href={mainHref}
              >
                {mainLabel}
              </Link>
              {isAdmin && (
                <Link
                  className="rounded-lg px-3 py-1.5 text-muted-foreground transition hover:bg-mist hover:text-ink"
                  href="/admin"
                >
                  Operations
                </Link>
              )}
            </>
          )}
          {loaded && !profile && (
            <Link className="tp-btn-primary !py-1.5 !text-xs" href="/login">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
