import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/server";

async function getOrganizationId(orgSlug: string) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;
  const supabase = await createServiceClient();
  const { data } = await supabase
    .from("organization_members")
    .select("role, organizations!inner(id, slug)")
    .eq("user_id", user.id)
    .eq("organizations.slug", orgSlug)
    .maybeSingle();
  if (!data || !["owner", "admin"].includes(data.role)) return null;
  return data.organizations[0]?.id ?? null;
}

export async function GET(_: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  const organizationId = await getOrganizationId((await params).orgSlug);
  if (!organizationId) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const supabase = await createServiceClient();
  const { data, error } = await supabase.from("prompt_variants").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ variants: data });
}

export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  const organizationId = await getOrganizationId((await params).orgSlug);
  if (!organizationId) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const value = body as Record<string, unknown>;
  if (typeof value.name !== "string" || !value.name.trim() || typeof value.systemPrompt !== "string" || !value.systemPrompt.trim() || typeof value.trafficWeight !== "number" || !Number.isInteger(value.trafficWeight) || value.trafficWeight < 0 || value.trafficWeight > 100) {
    return NextResponse.json({ error: "name, systemPrompt, and a trafficWeight from 0 to 100 are required." }, { status: 400 });
  }
  const supabase = await createServiceClient();
  const { data, error } = await supabase.from("prompt_variants").insert({ organization_id: organizationId, name: value.name.trim(), system_prompt: value.systemPrompt.trim(), traffic_weight: value.trafficWeight }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ variant: data }, { status: 201 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  const organizationId = await getOrganizationId((await params).orgSlug);
  if (!organizationId) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const value = body as Record<string, unknown>;
  if (typeof value.id !== "string" || typeof value.isActive !== "boolean") {
    return NextResponse.json({ error: "id and isActive are required." }, { status: 400 });
  }
  const supabase = await createServiceClient();
  const { data, error } = await supabase.from("prompt_variants")
    .update({ is_active: value.isActive })
    .eq("id", value.id)
    .eq("organization_id", organizationId)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Prompt variant not found." }, { status: 404 });
  return NextResponse.json({ variant: data });
}
