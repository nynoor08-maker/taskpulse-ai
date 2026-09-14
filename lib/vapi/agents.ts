type AgentContext = {
  taskDescription: string;
  maxBudget: number | null;
  vendorPhone: string;
};

const toolServer = {
  url: "https://taskpulse-ai.vercel.app/api/vapi/tools",
};

/** Builds a Vapi "handoff" tool that silently transfers the call to another squad member. */
function handoffTool(assistantName: string, description: string, functionName: string) {
  return {
    type: "handoff" as const,
    destinations: [
      {
        type: "assistant" as const,
        assistantName,
        description,
        contextEngineeringPlan: { type: "all" as const },
      },
    ],
    function: { name: functionName },
  };
}

const checkVendorAvailabilityTool = {
  type: "function" as const,
  messages: [{ type: "request-start" as const, content: "Checking schedule and pricing..." }],
  function: {
    name: "check_vendor_availability",
    description: "Checks a vendor's availability and pricing for a specific date.",
    parameters: {
      type: "object",
      properties: {
        vendorPhone: {
          type: "string",
          description: "Vendor phone number in E.164 format",
        },
        requestedDate: {
          type: "string",
          description: "Date requested for service in YYYY-MM-DD format",
        },
      },
      required: ["vendorPhone", "requestedDate"],
    },
  },
  server: toolServer,
};

/**
 * Builds a three-agent vendor negotiation squad: Triage confirms the merchant
 * is open and willing to take the job, Negotiator anchors and locks a price,
 * and Closing confirms an arrival window and texts the customer.
 */
export function createVendorSquad({ taskDescription, maxBudget, vendorPhone }: AgentContext) {
  const budget = maxBudget == null ? "the client's stated budget" : `$${maxBudget}`;

  return {
    members: [
      {
        assistant: {
          name: "Triage",
          firstMessage:
            "Hello! I'm calling on behalf of a client about a local service request. Do you have a quick moment?",
          maxDurationSeconds: 60,
          model: {
            provider: "openai",
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `You are the Triage agent in a multi-agent vendor-call system. In one or two exchanges, confirm the business is currently open and able to take on new work, and ask directly whether they accept emergency or same-day dispatches. Do not discuss price or scheduling details yourself. If they confirm they can take the job, call handoff_to_negotiator so the Negotiator can discuss pricing for: "${taskDescription}". If they say they are closed or cannot take new work, thank them politely and end the call.`,
              },
            ],
            tools: [
              handoffTool(
                "Negotiator",
                "Call once the vendor confirms they are open and willing to take the job.",
                "handoff_to_negotiator",
              ),
            ],
          },
        },
      },
      {
        assistant: {
          name: "Negotiator",
          maxDurationSeconds: 180,
          model: {
            provider: "openai",
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `You are the Negotiator in a multi-agent vendor-call system. Your only responsibility is negotiating a rate for this request: "${taskDescription}". Keep the price at or below ${budget}. The vendor's phone number is ${vendorPhone}. Use check_vendor_availability if you need to confirm scheduling windows while negotiating. Once the vendor verbally agrees to a specific dollar amount, call lock_quote with that exact amount to record it, then call handoff_to_closing so the Closing agent can confirm an arrival window. Do not confirm a booking time or arrival window yourself.`,
              },
            ],
            tools: [
              checkVendorAvailabilityTool,
              {
                type: "function",
                messages: [{ type: "request-start", content: "Locking in that price..." }],
                function: {
                  name: "lock_quote",
                  description: "Records the final agreed price once the vendor verbally confirms it.",
                  parameters: {
                    type: "object",
                    properties: {
                      agreedPrice: {
                        type: "number",
                        description: "The final dollar amount the vendor agreed to.",
                      },
                    },
                    required: ["agreedPrice"],
                  },
                },
                server: toolServer,
              },
              handoffTool(
                "Closing",
                "Call once a price has been locked in with lock_quote.",
                "handoff_to_closing",
              ),
            ],
          },
        },
      },
      {
        assistant: {
          name: "Closing",
          maxDurationSeconds: 120,
          model: {
            provider: "openai",
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `You are the Closing agent in a multi-agent vendor-call system. The Negotiator has already locked in a price for: "${taskDescription}". Briefly recap the agreed scope and price, then ask the vendor for a specific arrival window, such as "between 2 and 4 PM today". Once you have a specific window, call confirm_booking with it to finalize the job and text the customer a confirmation. Do not renegotiate the price.`,
              },
            ],
            tools: [
              {
                type: "function",
                messages: [{ type: "request-start", content: "Confirming your booking..." }],
                function: {
                  name: "confirm_booking",
                  description:
                    "Finalizes the job with the confirmed arrival window and texts the customer a confirmation.",
                  parameters: {
                    type: "object",
                    properties: {
                      arrivalWindow: {
                        type: "string",
                        description: "The confirmed arrival window, e.g. '2:00 PM - 4:00 PM today'.",
                      },
                    },
                    required: ["arrivalWindow"],
                  },
                },
                server: toolServer,
              },
            ],
          },
        },
      },
    ],
  };
}
