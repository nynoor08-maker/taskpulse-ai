import { NextResponse } from "next/server";
import { captureException, enforceRateLimit } from "@/lib/security";
import { createClient } from "@/server";

type TelephonyPayload = {
  vapiApiKey: string;
  vapiPhoneNumberId: string;
  twilioPhoneNumber: string | null;
};

function isPayload(value: unknown): value is TelephonyPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.vapiApiKey === "string" &&
    payload.vapiApiKey.trim().length > 0 &&
    typeof payload.vapiPhoneNumberId === "string" &&
    payload.vapiPhoneNumberId.trim().length > 0 &&
    (payload.twilioPhoneNumber === null ||
      (typeof payload.twilioPhoneNumber === "string" &&
        /^\+[1-9]\d{1,14}$/.test(payload.twilioPhoneNumber)))
  );
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const rateLimitResponse = await enforceRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!isPayload(payload)) {
    return NextResponse.json(
      { error: "A Vapi API key, Vapi phone number ID, and valid optional Twilio number are required." },
      { status: 400 },
    );
  }

  const { orgSlug } = await params;
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
    }

    const { data: organization, error: organizationError } = await supabase
      .from("organizations")
      .select("id")
      .eq("slug", orgSlug)
      .maybeSingle();
    if (organizationError || !organization) {
      return NextResponse.json({ error: "Organization not found." }, { status: 404 });
    }

    const { error } = await supabase.rpc("update_organization_telephony", {
      p_organization_id: organization.id,
      p_vapi_api_key: payload.vapiApiKey.trim(),
      p_vapi_phone_number_id: payload.vapiPhoneNumberId.trim(),
      p_twilio_phone_number: payload.twilioPhoneNumber,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
  } catch (error) {
    captureException(error, { route: "organization-telephony", orgSlug });
    return NextResponse.json(
      { error: "Unable to save organization telephony settings." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
