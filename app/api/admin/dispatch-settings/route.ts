import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as { dispatchPaused?: unknown }).dispatchPaused !== "boolean"
  ) {
    return NextResponse.json(
      { error: "dispatchPaused must be a boolean." },
      { status: 400 },
    );
  }
  const { dispatchPaused } = body as { dispatchPaused: boolean };

  let authorization;
  try {
    authorization = await requireAdmin();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to verify administrator access.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if ("error" in authorization) {
    return NextResponse.json({ error: authorization.error }, { status: 403 });
  }

  const { error } = await authorization.supabase
    .from("app_settings")
    .update({ dispatch_paused: dispatchPaused })
    .eq("key", "dispatch");

  if (error) {
    return NextResponse.json(
      { error: `Unable to update dispatch settings: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ dispatchPaused });
}
