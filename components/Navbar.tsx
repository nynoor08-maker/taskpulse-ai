"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/client";

type Profile = { role: "customer" | "vendor" | "admin"; is_admin: boolean };

export function Navbar() {
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("role, is_admin")
        .eq("id", user.id)
        .maybeSingle();
      if (data) setProfile(data as Profile);
    });
  }, []);

  if (!profile) return null;
  const isAdmin = profile.is_admin || profile.role === "admin";
  const mainHref = profile.role === "vendor" ? "/vendor" : "/dashboard";
  const mainLabel = profile.role === "vendor" ? "Vendor workspace" : "Dashboard";

  return (
    <nav className="border-b bg-white px-6 py-3">
      <div className="mx-auto flex max-w-7xl items-center gap-5 text-sm">
        <Link className="font-semibold text-slate-900" href={mainHref}>TaskPulse AI</Link>
        <Link className="text-slate-600 hover:text-slate-900" href={mainHref}>{mainLabel}</Link>
        {isAdmin && <Link className="text-slate-600 hover:text-slate-900" href="/admin">Operations</Link>}
      </div>
    </nav>
  );
}
