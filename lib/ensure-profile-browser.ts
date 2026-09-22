"use client";

import { createClient as createBrowserClient } from "@/client";

export type ProfileSummary = {
  role: "customer" | "vendor" | "admin";
  is_admin: boolean;
};

/** Client-side bootstrap after magic-link login when the DB trigger has not run yet. */
export async function ensureBrowserProfile(): Promise<ProfileSummary | null> {
  const supabase = createBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: existing } = await supabase
    .from("profiles")
    .select("role, is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (existing) return existing as ProfileSummary;

  const response = await fetch("/api/profile/ensure", { method: "POST" });
  if (!response.ok) return null;
  const body: unknown = await response.json().catch(() => null);
  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as { profile?: unknown }).profile !== "object" ||
    (body as { profile: unknown }).profile === null
  ) {
    return null;
  }
  return (body as { profile: ProfileSummary }).profile;
}
