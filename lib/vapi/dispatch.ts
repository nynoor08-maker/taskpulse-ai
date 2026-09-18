import type { createServiceClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/security";
import { createVendorSquad } from "@/lib/vapi/agents";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

export type SquadCallResult = {
  id: string;
  monitor?: { controlUrl?: string; listenUrl?: string };
};

export type RecordedVendorCall = {
  call: SquadCallResult;
  callLogId: string;
};

/**
 * Places an outbound Vapi call using the shared Triage/Negotiator/Closing
 * vendor squad and the platform's global Vapi credentials (the same
 * credentials used by the squad dispatch and inbound-intake routes).
 */
export async function placeVendorSquadCall(args: {
  description: string;
  maxBudget: number | null;
  vendorPhone: string;
}): Promise<SquadCallResult> {
  const apiKey = process.env.VAPI_API_KEY;
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
  if (!apiKey || !phoneNumberId) {
    throw new Error("Vapi configuration is incomplete.");
  }

  const response = await fetch("https://api.vapi.ai/call", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      squad: createVendorSquad({
        taskDescription: args.description,
        maxBudget: args.maxBudget,
        vendorPhone: args.vendorPhone,
      }),
      phoneNumberId,
      customer: { number: args.vendorPhone },
    }),
  });

  if (!response.ok) {
    throw new Error(`Vapi rejected the call: ${await response.text()}`);
  }

  const call = (await response.json()) as SquadCallResult;
  if (!call.id) throw new Error("Vapi returned no call ID.");
  return call;
}

/**
 * Best-effort cancellation of an in-flight squad call using its live-control
 * URL — the same `end-call` control the supervisor UI uses. Used to compensate
 * when persistence fails after a call was placed, so we never leave a live,
 * billable call running that no database record can track. Never throws:
 * the caller is already handling a failure and must not be masked by a
 * secondary error.
 */
export async function endVendorSquadCall(call: SquadCallResult): Promise<void> {
  const controlUrl = call.monitor?.controlUrl;
  if (!controlUrl) {
    // No live-control channel was returned, so we cannot auto-cancel. Surface
    // it so an operator can reconcile the orphaned call manually.
    captureException(new Error("Unable to cancel orphaned Vapi call: no control URL."), {
      route: "dispatch",
      operation: "cancel-orphaned-call",
      callId: call.id,
    });
    return;
  }
  try {
    await fetch(controlUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "end-call" }),
    });
  } catch (error) {
    captureException(error, {
      route: "dispatch",
      operation: "cancel-orphaned-call",
      callId: call.id,
    });
  }
}

/**
 * Places a vendor squad call and durably records it in a single logical unit.
 *
 * Placing a Vapi call is an irreversible external side effect: once the dial
 * starts the platform is billed and the squad begins negotiating. If we then
 * fail to persist the `call_logs` row, the end-of-call webhook can never match
 * the call (it looks up by `vapi_call_id`), producing an orphaned, untracked,
 * billable call. To keep dispatch transactional we cancel the call we just
 * placed whenever its record cannot be written, then rethrow so the caller can
 * surface the failure.
 *
 * Monitor-credential persistence is best-effort: the call is already tracked
 * and the webhook can reconcile it, so a failure there only costs live
 * supervisor controls for that call and must not trigger a cancellation.
 */
export async function dispatchAndRecordVendorCall(
  supabase: ServiceClient,
  args: {
    description: string;
    maxBudget: number | null;
    vendorPhone: string;
    taskId: string;
    organizationId?: string | null;
  },
): Promise<RecordedVendorCall> {
  const call = await placeVendorSquadCall({
    description: args.description,
    maxBudget: args.maxBudget,
    vendorPhone: args.vendorPhone,
  });

  const { data: callLog, error: callLogError } = await supabase
    .from("call_logs")
    .insert({
      organization_id: args.organizationId ?? null,
      task_id: args.taskId,
      vapi_call_id: call.id,
      vendor_phone: args.vendorPhone,
      status: "in_progress",
    })
    .select("id")
    .single();

  if (callLogError || !callLog) {
    await endVendorSquadCall(call);
    throw new Error(
      `Unable to record call log; cancelled orphaned Vapi call ${call.id}: ${
        callLogError?.message ?? "no row returned"
      }`,
    );
  }

  if (call.monitor?.controlUrl) {
    const { error: monitorError } = await supabase
      .from("call_monitor_credentials")
      .insert({
        call_log_id: callLog.id,
        vapi_control_url: call.monitor.controlUrl,
        vapi_listen_url: call.monitor.listenUrl ?? null,
      });
    if (monitorError) {
      captureException(monitorError, {
        route: "dispatch",
        callId: call.id,
        operation: "save-monitor-credentials",
      });
    }
  }

  return { call, callLogId: callLog.id };
}
