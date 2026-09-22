/**
 * Smoke E2E: create task → simulate failed call → apply vendor quote → assert pay-ready state.
 *
 * Modes:
 * - Default (DB): requires Supabase service role + SMOKE_E2E_ALLOW=true
 * - Code markers always run (squad path, quote helper, dispatch gate)
 *
 * Optional live dial: SMOKE_E2E_ALLOW_LIVE_DISPATCH=true (places a real squad call).
 */
import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { applyVendorQuote } from "../lib/vendor-quote";
import { pickAgreedPrice } from "../lib/pick-agreed-price";
import { placeVendorSquadCall } from "../lib/vapi/dispatch";
import { loadWorkspaceEnv } from "./load-workspace-env";

loadWorkspaceEnv();

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function log(stage: string, detail: string) {
  console.log(`[${stage}] ${detail}`);
}

async function assertCodeMarkers() {
  const [dispatchCall, dispatchSquad, v1Tasks, tasksRoute] = await Promise.all([
    readFile("app/api/dispatch-call/route.ts", "utf8"),
    readFile("app/api/dispatch-squad/route.ts", "utf8"),
    readFile("app/api/v1/tasks/route.ts", "utf8"),
    readFile("app/api/tasks/route.ts", "utf8"),
  ]);
  if (!dispatchCall.includes("isSingleAssistantDispatchAllowed")) {
    throw new Error("dispatch-call is not gated.");
  }
  if (!dispatchSquad.includes("placeVendorSquadCall")) {
    throw new Error("dispatch-squad is not using placeVendorSquadCall.");
  }
  if (!v1Tasks.includes("placeVendorSquadCall")) {
    throw new Error("v1/tasks is not using squad dispatch.");
  }
  if (!tasksRoute.includes("placeVendorSquadCall")) {
    throw new Error("dashboard /api/tasks is not using squad dispatch.");
  }
  log("CODE", "Squad-canonical markers OK");
}

async function ensureSmokeFixtures(supabase: SupabaseClient) {
  const customerId = required("SMOKE_E2E_CUSTOMER_USER_ID");
  const vendorUserId = required("SMOKE_E2E_VENDOR_USER_ID");
  const vendorPhone = required("SMOKE_E2E_VENDOR_PHONE");
  if (!/^\+[1-9]\d{1,14}$/.test(vendorPhone)) {
    throw new Error("SMOKE_E2E_VENDOR_PHONE must be E.164.");
  }

  for (const [id, email, role] of [
    [customerId, "smoke-customer@taskpulse.local", "customer"],
    [vendorUserId, "smoke-vendor@taskpulse.local", "vendor"],
  ] as const) {
    const { error } = await supabase.from("profiles").upsert(
      { id, email, role, is_admin: false },
      { onConflict: "id" },
    );
    if (error) throw new Error(`Unable to upsert profile ${email}: ${error.message}`);
  }

  const { data: vendor, error: vendorError } = await supabase
    .from("vendors")
    .upsert(
      {
        user_id: vendorUserId,
        business_name: "Smoke Test Plumbing",
        phone_number: vendorPhone,
        hourly_rate: 95,
        is_accepting_jobs: true,
      },
      { onConflict: "phone_number" },
    )
    .select("id, phone_number")
    .single();
  if (vendorError) throw new Error(`Unable to upsert vendor: ${vendorError.message}`);

  return { customerId, vendorPhone: vendor.phone_number };
}

async function runDatabaseSmoke(supabase: SupabaseClient) {
  const { customerId, vendorPhone } = await ensureSmokeFixtures(supabase);
  const description = `Smoke E2E clogged drain ${new Date().toISOString()}`;

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .insert({
      user_id: customerId,
      title: description.slice(0, 120),
      description,
      target_vendor_phone: vendorPhone,
      max_budget: 220,
      source: "web",
      status: "in_progress",
    })
    .select("id")
    .single();
  if (taskError) throw new Error(`Unable to create smoke task: ${taskError.message}`);
  log("TASK", `Created ${task.id}`);

  const { error: failLogError } = await supabase.from("call_logs").insert({
    task_id: task.id,
    vendor_phone: vendorPhone,
    status: "failed",
    summary: "Simulated failed negotiation for smoke E2E",
  });
  if (failLogError) throw new Error(`Unable to insert failed call log: ${failLogError.message}`);
  log("CALL", "Simulated failed call");

  if (process.env.SMOKE_E2E_ALLOW_LIVE_DISPATCH === "true") {
    const call = await placeVendorSquadCall({
      description,
      maxBudget: 220,
      vendorPhone,
    });
    log("LIVE", `Placed squad call ${call.id}`);
  }

  const quotedPrice = 185;
  const { callLogId } = await applyVendorQuote(supabase, {
    taskId: task.id,
    vendorPhone,
    organizationId: null,
    quotedPrice,
    availableTime: "2:00 PM - 4:00 PM today",
    notes: "Smoke E2E quote",
  });
  log("QUOTE", `Applied quote on call log ${callLogId}`);

  const { data: completed, error: loadError } = await supabase
    .from("tasks")
    .select("id, status, payment_status, call_logs(agreed_price, created_at)")
    .eq("id", task.id)
    .single();
  if (loadError) throw new Error(loadError.message);
  if (completed.status !== "completed") {
    throw new Error(`Expected task completed, got ${completed.status}`);
  }
  const agreed = pickAgreedPrice(completed.call_logs);
  if (agreed !== quotedPrice) {
    throw new Error(`Expected agreed price ${quotedPrice}, got ${String(agreed)}`);
  }
  if (completed.payment_status !== "unpaid") {
    throw new Error("Expected unpaid payment_status for pay button readiness.");
  }
  log("PAY", `Pay button ready at $${agreed}`);
  return task.id;
}

async function main() {
  await assertCodeMarkers();

  if (process.env.SMOKE_E2E_ALLOW !== "true") {
    log(
      "SKIP",
      "DB smoke skipped. Set SMOKE_E2E_ALLOW=true plus SMOKE_E2E_CUSTOMER_USER_ID, SMOKE_E2E_VENDOR_USER_ID, SMOKE_E2E_VENDOR_PHONE to run fixtures.",
    );
    return;
  }

  const supabase = createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  const taskId = await runDatabaseSmoke(supabase);
  log("DONE", `Smoke E2E passed for task ${taskId}`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
