import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/server";
import { ensureProfileForUser } from "@/lib/ensure-profile";
import { enforceRateLimit } from "@/lib/security";

type VendorPayload = {
  businessName: string;
  phoneNumber: string;
  hourlyRate: number;
  email?: string;
};

function isVendorPayload(value: unknown): value is VendorPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.businessName === "string" &&
    payload.businessName.trim().length > 0 &&
    typeof payload.phoneNumber === "string" &&
    /^\+[1-9]\d{1,14}$/.test(payload.phoneNumber) &&
    typeof payload.hourlyRate === "number" &&
    Number.isFinite(payload.hourlyRate) &&
    payload.hourlyRate >= 0 &&
    (payload.email === undefined || typeof payload.email === "string")
  );
}

export async function POST(request: Request) {
  const rateLimitResponse = await enforceRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const body: unknown = await request.json().catch(() => null);
  if (!isVendorPayload(body)) {
    return NextResponse.json(
      {
        error:
          "businessName, phoneNumber (E.164), and hourlyRate are required.",
      },
      { status: 400 },
    );
  }

  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }

  try {
    await ensureProfileForUser(user);
    const supabase = await createServiceClient();

    const { data: existing } = await supabase
      .from("vendors")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: "A vendor profile already exists for this account." }, { status: 409 });
    }

    const { data: vendor, error: vendorError } = await supabase
      .from("vendors")
      .insert({
        user_id: user.id,
        business_name: body.businessName.trim(),
        phone_number: body.phoneNumber,
        hourly_rate: body.hourlyRate,
        email: body.email?.trim() || user.email || null,
        is_accepting_jobs: true,
      })
      .select("id, business_name, phone_number, hourly_rate, is_accepting_jobs")
      .single();
    if (vendorError) {
      return NextResponse.json({ error: vendorError.message }, { status: 500 });
    }

    const { error: roleError } = await supabase
      .from("profiles")
      .update({ role: "vendor" })
      .eq("id", user.id);
    if (roleError) {
      return NextResponse.json({ error: roleError.message }, { status: 500 });
    }

    return NextResponse.json({ vendor }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create vendor profile." },
      { status: 500 },
    );
  }
}
