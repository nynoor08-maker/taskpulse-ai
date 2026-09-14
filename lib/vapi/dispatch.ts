import { createVendorSquad } from "@/lib/vapi/agents";

export type SquadCallResult = {
  id: string;
  monitor?: { controlUrl?: string; listenUrl?: string };
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
