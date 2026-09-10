import { createClient } from "@supabase/supabase-js";

const timeoutMs = 120_000;
const pollIntervalMs = 3_000;

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function log(state: "INITIATED" | "IN_PROGRESS" | "TOOL_CALLED" | "COMPLETED", detail: string) {
  console.log(`[${state}] ${detail}`);
}

async function main() {
  if (process.env.LIVE_VOICE_TEST_ALLOW_CALL !== "true") {
    throw new Error("Refusing to place a call. Set LIVE_VOICE_TEST_ALLOW_CALL=true only for a consented test number.");
  }
  const targetNumber = required("LIVE_VOICE_TEST_PHONE_NUMBER");
  if (!/^\+[1-9]\d{1,14}$/.test(targetNumber)) throw new Error("LIVE_VOICE_TEST_PHONE_NUMBER must be E.164.");
  const supabase = createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  const organizationId = required("LIVE_VOICE_TEST_ORGANIZATION_ID");
  const userId = required("LIVE_VOICE_TEST_USER_ID");
  const apiKey = required("VAPI_API_KEY");
  const assistantId = required("VAPI_ASSISTANT_ID");
  const assistantVersion = required("VAPI_ASSISTANT_VERSION");
  const phoneNumberId = required("VAPI_PHONE_NUMBER_ID");

  const { data: task, error: taskError } = await supabase.from("tasks").insert({
    organization_id: organizationId,
    user_id: userId,
    title: "Emergency Plumbing Repair",
    description: "Emergency plumbing repair. Verify available appointment times for the requested date before discussing a price.",
    target_vendor_phone: targetNumber,
    max_budget: 200,
  }).select("id").single();
  if (taskError) throw new Error(`Unable to create test task: ${taskError.message}`);

  const callResponse = await fetch("https://api.vapi.ai/call", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      assistantId,
      assistantVersion,
      phoneNumberId,
      customer: { number: targetNumber },
      assistantOverrides: {
        variableValues: {
          taskDescription: "Emergency Plumbing Repair",
          maxBudget: "200",
          vendorPhone: targetNumber,
        },
      },
    }),
  });
  if (!callResponse.ok) throw new Error(`Vapi rejected test call: ${await callResponse.text()}`);
  const call = (await callResponse.json()) as { id?: string };
  if (!call.id) throw new Error("Vapi returned no call ID.");

  const { data: callLog, error: callLogError } = await supabase.from("call_logs").insert({
    organization_id: organizationId,
    task_id: task.id,
    vapi_call_id: call.id,
    status: "in_progress",
  }).select("id").single();
  if (callLogError) throw new Error(`Unable to create test call log: ${callLogError.message}`);
  await supabase.from("tasks").update({ status: "in_progress" }).eq("id", task.id);
  log("INITIATED", `Vapi call ${call.id}; task ${task.id}`);

  const deadline = Date.now() + timeoutMs;
  let inProgressLogged = false;
  let toolLogged = false;
  while (Date.now() < deadline) {
    const [{ data: currentLog, error: pollError }, { data: tools, error: toolsError }] = await Promise.all([
      supabase.from("call_logs").select("status, transcript, summary, agreed_price, available_time").eq("id", callLog.id).single(),
      supabase.from("tool_call_logs").select("tool_name").eq("call_log_id", callLog.id),
    ]);
    if (pollError || toolsError) throw new Error(pollError?.message ?? toolsError?.message);
    if (currentLog.status === "in_progress" && !inProgressLogged) {
      log("IN_PROGRESS", `Call record ${callLog.id} is active.`);
      inProgressLogged = true;
    }
    if ((tools?.length ?? 0) > 0 && !toolLogged) {
      log("TOOL_CALLED", tools!.map((tool) => tool.tool_name).join(", "));
      toolLogged = true;
    }
    if (currentLog.status === "completed" || currentLog.status === "failed") {
      log("COMPLETED", `Status: ${currentLog.status}; agreed price: ${currentLog.agreed_price ?? "none"}; available time: ${currentLog.available_time ?? "none"}`);
      console.log(`Transcript summary:\n${currentLog.summary ?? currentLog.transcript ?? "No transcript received."}`);
      if (currentLog.status !== "completed") throw new Error("Live call did not complete successfully.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error("Timed out waiting for Vapi's end-of-call webhook. Confirm the deployed webhook URL and VAPI_WEBHOOK_SECRET.");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
