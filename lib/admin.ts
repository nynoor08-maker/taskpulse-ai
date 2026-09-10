import { createClient, createServiceClient } from "@/server";

export async function requireAdmin() {
  const userClient = await createClient();
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return { error: "Authentication is required." } as const;
  }

  const supabase = await createServiceClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_admin, role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error(`Unable to verify administrator access: ${profileError.message}`);
  }

  if (!profile?.is_admin && profile?.role !== "admin") {
    return { error: "Administrator access is required." } as const;
  }

  return { supabase } as const;
}
