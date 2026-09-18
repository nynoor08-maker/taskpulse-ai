import type { User } from "@supabase/supabase-js";
import { createClient as createBrowserClient } from "@/client";
import { createServiceClient } from "@/server";

type ProfileRole = "customer" | "vendor" | "admin";

export type ProfileSummary = {
  role: ProfileRole;
  is_admin: boolean;
};

/** Ensures an auth user has a profiles row (service role; for server routes). */
export async function ensureProfileForUser(user: User): Promise<ProfileSummary> {
  const supabase = await createServiceClient();
  const { data: existing, error: lookupError } = await supabase
    .from("profiles")
    .select("role, is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (lookupError) throw new Error(`Unable to load profile: ${lookupError.message}`);
  if (existing) return existing as ProfileSummary;

  const { data: created, error: insertError } = await supabase
    .from("profiles")
    .insert({
      id: user.id,
      email: user.email ?? null,
      full_name:
        typeof user.user_metadata?.full_name === "string"
          ? user.user_metadata.full_name
          : null,
      role: "customer",
      is_admin: false,
    })
    .select("role, is_admin")
    .single();
  if (insertError) throw new Error(`Unable to create profile: ${insertError.message}`);
  return created as ProfileSummary;
}

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
