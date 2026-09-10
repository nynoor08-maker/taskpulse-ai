import { notFound, redirect } from "next/navigation";
import { TelephonySettingsForm } from "./telephony-settings-form";
import { createClient } from "@/server";

export default async function TelephonySettingsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: membership, error } = await supabase
    .from("organization_members")
    .select("role, organizations!inner(slug)")
    .eq("user_id", user.id)
    .eq("organizations.slug", orgSlug)
    .maybeSingle();
  if (error) throw new Error(`Unable to load organization membership: ${error.message}`);
  if (!membership || !["owner", "admin"].includes(membership.role)) notFound();

  return <TelephonySettingsForm orgSlug={orgSlug} />;
}
