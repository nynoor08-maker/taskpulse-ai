import type { User } from "@supabase/supabase-js";
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
