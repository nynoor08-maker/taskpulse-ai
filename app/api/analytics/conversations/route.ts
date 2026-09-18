import { NextResponse } from "next/server";
import { analyzeCallLog } from "@/lib/conversation-analytics";
import { asOne } from "@/lib/relations";
import { createClient, createServiceClient } from "@/server";

export async function POST(request: Request) {
  let body: { callLogId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (typeof body.callLogId !== "string" || !body.callLogId) {
    return NextResponse.json({ error: "callLogId is required." }, { status: 400 });
  }

  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  const supabase = await createServiceClient();
  const { data: callLog, error } = await supabase
    .from("call_logs")
    .select("id, tasks!inner(user_id)")
    .eq("id", body.callLogId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!callLog || asOne(callLog.tasks)?.user_id !== user.id) {
    return NextResponse.json({ error: "Call not found." }, { status: 404 });
  }

  try {
    return NextResponse.json({ analysis: await analyzeCallLog(callLog.id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to analyze conversation." }, { status: 502 });
  }
}
