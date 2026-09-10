import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/security";
import { createServiceClient } from "@/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const rateLimitResponse = await enforceRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token?.startsWith("tp_live_")) {
    return NextResponse.json({ error: "A valid bearer API key is required." }, { status: 401 });
  }
  const { taskId } = await params;
  const supabase = await createServiceClient();
  const keyHash = createHash("sha256").update(token).digest("hex");
  const { data: apiKey } = await supabase
    .from("api_keys")
    .select("organization_id")
    .eq("key_hash", keyHash)
    .maybeSingle();
  if (!apiKey) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });

  const { data: task, error } = await supabase
    .from("tasks")
    .select("id, status, created_at")
    .eq("id", taskId)
    .eq("organization_id", apiKey.organization_id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Unable to load task." }, { status: 500 });
  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  return NextResponse.json(task);
}
