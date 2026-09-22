import { NextResponse } from "next/server";
import { createClient } from "@/server";
import { ensureProfileForUser } from "@/lib/ensure-profile";
import { enforceRateLimit } from "@/lib/security";

export async function POST(request: Request) {
  const rateLimitResponse = await enforceRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }

  try {
    const profile = await ensureProfileForUser(user);
    return NextResponse.json({ profile });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to ensure profile." },
      { status: 500 },
    );
  }
}
