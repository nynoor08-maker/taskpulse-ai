import { createClient } from "@supabase/supabase-js";
import { placeVendorSquadCall } from "../lib/vapi/dispatch";

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
    throw new Error(
      "Refusing to place a call. Set LIVE_VOICE_TEST_ALLOW_CALL=true only for a consented test number.",
    );
  }
  const targetNumber = required("LIVE_VOICE_TEST_PHONE_NUMBER");
  if (!/^\+[1-9]\d{1,14}$/.test(targetNumber)) {
    throw new Error("LIVE_VOICE_TEST_PHONE_NUMBER must be E.164.");
  }
  const supabase = createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  const organizationId = required("LIVE_VOICE_TEST_ORGANIZATION_ID");
  const userId = required("LIVE_VOICE_TEST_USER_ID");

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .insert({
      organization_id: organizationId,
      user_id: userId,
      title: "Emergency Plumbing Repair",
      description:
        "Emergency plumbing repair. Verify available appointment times for the requested date before discussing a price.",
      target_vendor_phone: targetNumber,
      max_budget: 200,
      source: "api",
    })
    .select("id")
    .single();
  if (taskError) throw new Error(`Unable to create test task: ${taskError.message}`);

  const call = await placeVendorSquadCall({
    description:
      "Emergency plumbing repair. Verify available appointment times for the requested date before discussing a price.",
    maxBudget: 200,
    vendorPhone: targetNumber,
  });
  log("INITIATED", `Squad call ${call.id} for task ${task.id}`);

  const { error: callLogError } = await supabase.from("call_logs").insert({
    organization_id: organizationId,
    task_id: task.id,
    vapi_call_id: call.id,
    vendor_phone: targetNumber,
    status: "in_progress",
  });
  if (callLogError) throw new Error(`Unable to create call log: ${callLogError.message}`);

  await supabase.from("tasks").update({ status: "in_progress" }).eq("id", task.id);

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { data: callLog } = await supabase
      .from("call_logs")
      .select("status, agreed_price, available_time")
      .eq("vapi_call_id", call.id)
      .maybeSingle();
    if (callLog?.status === "in_progress") log("IN_PROGRESS", "Waiting for squad tools / completion");
    if (callLog?.agreed_price != null) log("TOOL_CALLED", `Agreed ${callLog.agreed_price}`);
    if (callLog?.status === "completed") {
      log(
        "COMPLETED",
        `status=${callLog.status} price=${String(callLog.agreed_price)} window=${String(callLog.available_time)}`,
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error("Timed out waiting for live squad call completion webhook.");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
