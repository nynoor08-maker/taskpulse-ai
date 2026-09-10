import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/server";

export async function GET(_: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  const supabase = await createServiceClient();
  const { data: membership } = await supabase.from("organization_members").select("role, organizations!inner(id, slug)").eq("user_id", user.id).eq("organizations.slug", orgSlug).maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  const organization = membership.organizations[0];
  if (!organization) return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  const organizationId = organization.id;
  const { data, error } = await supabase.from("call_logs").select("id, vapi_call_id, created_at, tasks(title, target_vendor_phone)").eq("organization_id", organizationId).eq("status", "in_progress").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ calls: (data ?? []).map((call) => ({ ...call, tasks: call.tasks[0] ?? null })) });
}
