import { notFound, redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/server";
import { CallSupervisor } from "./call-supervisor";

export default async function CallsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/");
  const { data: membership } = await client.from("organization_members").select("role, organizations!inner(id, slug)").eq("user_id", user.id).eq("organizations.slug", orgSlug).maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) notFound();
  const organization = membership.organizations[0];
  if (!organization) notFound();
  const organizationId = organization.id;
  const supabase = await createServiceClient();
  const { data: calls, error } = await supabase.from("call_logs").select("id, vapi_call_id, created_at, tasks(title, target_vendor_phone)").eq("organization_id", organizationId).eq("status", "in_progress").order("created_at", { ascending: false });
  if (error) throw new Error(`Unable to load active calls: ${error.message}`);
  return <CallSupervisor initialCalls={(calls ?? []).map((call) => ({
    ...call,
    tasks: call.tasks[0] ?? null,
  }))} orgSlug={orgSlug} />;
}
