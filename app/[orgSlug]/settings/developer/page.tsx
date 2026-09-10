import { notFound, redirect } from "next/navigation";
import { DeveloperSettings } from "./developer-settings";
import { createClient } from "@/server";

export default async function DeveloperSettingsPage({
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

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role, organizations!inner(slug)")
    .eq("user_id", user.id)
    .eq("organizations.slug", orgSlug)
    .maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) notFound();

  return <DeveloperSettings orgSlug={orgSlug} />;
}
