type JsonRecord = Record<string, unknown>;

type Persona = {
  name: string;
  instructions: string;
};

const personas: Persona[] = [
  {
    name: "Strict Vendor",
    instructions:
      "You are a vendor who refuses to negotiate below $250. State that price clearly, ask the caller to confirm it, and do not agree to a lower price.",
  },
  {
    name: "Busy Vendor",
    instructions:
      "You are a busy vendor. Ask rapid-fire questions about the requested date, duration, address, and booking availability. Require the caller to verify schedule details before you continue.",
  },
  {
    name: "Unclear Vendor",
    instructions:
      "You are a vendor who gives ambiguous pricing and schedule details. Do not invent a firm price or time. Make the caller ask clarifying questions before you provide a specific detail.",
  },
];

const requiredEnvironment = [
  "VAPI_API_KEY",
  "VAPI_ASSISTANT_ID",
  "VAPI_ASSISTANT_VERSION",
  "VAPI_SIMULATION_PERSONALITY_ID",
] as const;

function getEnvironment(name: (typeof requiredEnvironment)[number]) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

async function vapiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.vapi.ai${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getEnvironment("VAPI_API_KEY")}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Vapi ${init.method ?? "GET"} ${path} failed: ${body}`);
  }

  return JSON.parse(body) as T;
}

async function waitForRun(runId: string) {
  const deadline = Date.now() + 10 * 60 * 1000;

  while (Date.now() < deadline) {
    const run = await vapiRequest<JsonRecord>(`/eval/simulation/run/${runId}`);
    if (run.status === "ended") return run;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  throw new Error("Timed out waiting for the Vapi simulation run to finish.");
}

async function main() {
  for (const name of requiredEnvironment) getEnvironment(name);

  const personalityId = getEnvironment("VAPI_SIMULATION_PERSONALITY_ID");
  const simulationIds: string[] = [];

  for (const persona of personas) {
    const scenario = await vapiRequest<{ id: string }>("/eval/simulation/scenario", {
      method: "POST",
      body: JSON.stringify({
        name: `TaskPulse ${persona.name}`,
        instructions: persona.instructions,
        evaluations: [
          {
            structuredOutput: {
              name: "availability_checked",
              description:
                "Return true only if check_vendor_availability was called with a valid E.164 phone number and YYYY-MM-DD date.",
              schema: { type: "boolean" },
            },
            comparator: "=",
            value: true,
            required: true,
          },
          {
            structuredOutput: {
              name: "negotiation_output_is_grounded",
              description:
                "Return true only if agreed_price and available_time are explicitly provided by the vendor or tool, not invented.",
              schema: { type: "boolean" },
            },
            comparator: "=",
            value: true,
            required: true,
          },
          {
            structuredOutput: {
              name: "call_within_duration_limit",
              description:
                "Return true only if the call duration is at most 180 seconds.",
              schema: { type: "boolean" },
            },
            comparator: "=",
            value: true,
            required: true,
          },
        ],
      }),
    });

    const simulation = await vapiRequest<{ id: string }>("/eval/simulation", {
      method: "POST",
      body: JSON.stringify({ scenarioId: scenario.id, personalityId }),
    });
    simulationIds.push(simulation.id);
  }

  const suite = await vapiRequest<{ id: string }>("/eval/simulation/suite", {
    method: "POST",
    body: JSON.stringify({
      name: "TaskPulse vendor-negotiation regression",
      simulationIds,
    }),
  });

  const run = await vapiRequest<{ id: string }>("/eval/simulation/run", {
    method: "POST",
    body: JSON.stringify({
      simulations: [
        { type: "simulationSuite", simulationSuiteId: suite.id },
      ],
      target: {
        type: "assistant",
        assistantId: getEnvironment("VAPI_ASSISTANT_ID"),
        assistantVersion: getEnvironment("VAPI_ASSISTANT_VERSION"),
      },
      transport: { provider: "vapi.websocket" },
      iterations: 1,
    }),
  });

  const completedRun = await waitForRun(run.id);
  const itemCounts = isRecord(completedRun.itemCounts)
    ? completedRun.itemCounts
    : null;
  if (!itemCounts || itemCounts.failed !== 0 || itemCounts.passed !== personas.length) {
    throw new Error(`Simulation evaluations failed: ${JSON.stringify(itemCounts)}`);
  }

  console.log(`Vapi agent evaluation passed: ${run.id}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
