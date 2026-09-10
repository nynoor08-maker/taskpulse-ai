type AgentContext = {
  taskDescription: string;
  maxBudget: number | null;
  vendorPhone: string;
};

const toolServer = {
  url: "https://taskpulse-ai.vercel.app/api/vapi/tools",
};

export function createVendorSquad({ taskDescription, maxBudget, vendorPhone }: AgentContext) {
  const budget = maxBudget == null ? "the client's stated budget" : `$${maxBudget}`;

  return {
    members: [
      {
        assistant: {
          name: "Negotiator",
          firstMessage:
            "Hello! I am calling on behalf of a client regarding a local service request. Do you have a moment to talk?",
          maxDurationSeconds: 180,
          model: {
            provider: "openai",
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `You are the Negotiator in a multi-agent vendor-call system. Your only responsibility is negotiating a rate for this request: "${taskDescription}". Keep the price at or below ${budget}. Do not promise a booking time or collect scheduling details. Once the vendor agrees to a price, call handoff_to_scheduler silently so the Scheduler can confirm availability.`,
              },
            ],
            tools: [
              {
                type: "handoff",
                destinations: [
                  {
                    type: "assistant",
                    assistantName: "Scheduler",
                    description:
                      "Call after the vendor agrees to a price and scheduling needs to be confirmed.",
                    contextEngineeringPlan: { type: "all" },
                  },
                ],
                function: { name: "handoff_to_scheduler" },
              },
            ],
          },
        },
      },
      {
        assistant: {
          name: "Scheduler",
          maxDurationSeconds: 180,
          model: {
            provider: "openai",
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `You are the Scheduler in a multi-agent vendor-call system. The Negotiator has already handled pricing for: "${taskDescription}". Confirm the requested service date, available appointment time, and necessary service details. Use check_vendor_availability whenever schedule verification is needed. Do not renegotiate the agreed price. The vendor phone number is ${vendorPhone}.`,
              },
            ],
            tools: [
              {
                type: "function",
                messages: [
                  {
                    type: "request-start",
                    content: "Checking schedule and pricing...",
                  },
                ],
                function: {
                  name: "check_vendor_availability",
                  description:
                    "Checks a vendor's availability and pricing for a specific date.",
                  parameters: {
                    type: "object",
                    properties: {
                      vendorPhone: {
                        type: "string",
                        description: "Vendor phone number in E.164 format",
                      },
                      requestedDate: {
                        type: "string",
                        description:
                          "Date requested for service in YYYY-MM-DD format",
                      },
                    },
                    required: ["vendorPhone", "requestedDate"],
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
