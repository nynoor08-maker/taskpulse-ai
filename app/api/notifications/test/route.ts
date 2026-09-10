import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/server";
import { sendTaskSMS } from "@/lib/twilio";

export async function POST() {
  let userClient;
  let supabase;
  try {
    userClient = await createClient();
    supabase = await createServiceClient();
  } catch {
    return NextResponse.json(
      { error: "Supabase server configuration is incomplete." },
      { status: 500 },
    );
  }

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("phone_number")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json(
      { error: `Unable to look up recipient: ${profileError.message}` },
      { status: 500 },
    );
  }

  if (!profile?.phone_number) {
    return NextResponse.json(
      { error: "Add a phone number to your profile before sending a test SMS." },
      { status: 409 },
    );
  }

  try {
    const message = await sendTaskSMS(
      profile.phone_number,
      "TaskPulse Alert: This is a test SMS notification.",
    );
    return NextResponse.json({ success: true, messageSid: message.sid });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unable to send test SMS.";
    return NextResponse.json({ error: errorMessage }, { status: 502 });
  }
}
