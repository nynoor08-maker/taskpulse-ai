import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/server";

type Intervention = "takeover" | "mute_assistant" | "unmute_assistant" | "end_call";

function isIntervention(value: unknown): value is Intervention {
  return value === "takeover" || value === "mute_assistant" || value === "unmute_assistant" || value === "end_call";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; callLogId: string }> },
) {
  const { orgSlug, callLogId } = await params;
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  const action = body && typeof body === "object" ? (body as { action?: unknown }).action : null;
  if (!isIntervention(action)) return NextResponse.json({ error: "A valid action is required." }, { status: 400 });

  const supabase = await createServiceClient();
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role, organizations!inner(id, slug)")
    .eq("user_id", user.id)
    .eq("organizations.slug", orgSlug)
    .maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  }
  const organization = membership.organizations[0];
  if (!organization) return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  const organizationId = organization.id;
  const { data: callLog, error: callError } = await supabase
    .from("call_logs")
    .select("id, status")
    .eq("id", callLogId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (callError) return NextResponse.json({ error: callError.message }, { status: 500 });
  if (!callLog || callLog.status !== "in_progress") return NextResponse.json({ error: "This call is no longer active." }, { status: 409 });
  const { data: credentials, error: credentialsError } = await supabase
    .from("call_monitor_credentials")
    .select("vapi_control_url")
    .eq("call_log_id", callLog.id)
    .maybeSingle();
  if (credentialsError) return NextResponse.json({ error: credentialsError.message }, { status: 500 });
  if (!credentials) return NextResponse.json({ error: "Live Vapi controls are unavailable for this call." }, { status: 409 });

  const { data: supervisor, error: supervisorError } = await supabase
    .from("profiles")
    .select("phone_number")
    .eq("id", user.id)
    .single();
  if (supervisorError) return NextResponse.json({ error: supervisorError.message }, { status: 500 });
  if (action === "takeover" && (!supervisor.phone_number || !/^\+[1-9]\d{1,14}$/.test(supervisor.phone_number))) {
    return NextResponse.json({ error: "Add an E.164 phone number to your profile before taking over a call." }, { status: 409 });
  }

  const controlBody = action === "takeover"
    ? { type: "transfer", destination: { type: "number", number: supervisor.phone_number }, content: "Please hold while I connect you to a supervisor." }
    : action === "end_call"
      ? { type: "end-call" }
      : { type: "control", control: action === "mute_assistant" ? "mute-assistant" : "unmute-assistant" };
  let response: Response;
  try {
    response = await fetch(credentials.vapi_control_url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(controlBody) });
  } catch {
    return NextResponse.json({ error: "Unable to contact Vapi live controls." }, { status: 502 });
  }
  if (!response.ok) return NextResponse.json({ error: `Vapi rejected the action: ${await response.text()}` }, { status: 502 });
  const { error: auditError } = await supabase.from("call_interventions").insert({
    call_log_id: callLog.id, organization_id: organizationId, initiated_by_user_id: user.id, action,
    destination_phone: action === "takeover" ? supervisor.phone_number : null,
  });
  if (auditError) return NextResponse.json({ error: `Intervention completed but could not be audited: ${auditError.message}` }, { status: 500 });
  return NextResponse.json({ success: true });
}
