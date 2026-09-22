import { NextResponse } from "next/server";
import OpenAI from "openai";
import twilio from "twilio";
import { createServiceClient } from "@/server";
import { dispatchWebhookEvent } from "@/lib/events/webhook-dispatcher";
import { captureException, enforceWebhookRateLimit } from "@/lib/security";

type QuoteExtraction = {
  agreedPrice: number | null;
  availableTime: string | null;
};

function isQuoteExtraction(value: unknown): value is QuoteExtraction {
  if (!value || typeof value !== "object") return false;

  const extraction = value as Record<string, unknown>;
  return (
    (typeof extraction.agreedPrice === "number" &&
      Number.isFinite(extraction.agreedPrice) &&
      extraction.agreedPrice > 0) ||
    extraction.agreedPrice === null
  ) && (typeof extraction.availableTime === "string" || extraction.availableTime === null);
}

async function extractQuote(message: string): Promise<QuoteExtraction> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI configuration is incomplete.");

  const completion = await new OpenAI({ apiKey }).chat.completions.create({
    model: "gpt-4o-mini",
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "vendor_quote",
        strict: true,
        schema: {
          type: "object",
          properties: {
            agreedPrice: {
              type: ["number", "null"],
              description:
                "The explicit numeric dollar price the vendor quoted, or null if no definite price was quoted.",
            },
            availableTime: {
              type: ["string", "null"],
              description:
                "The explicit available date or time the vendor gave, or null if none was stated.",
            },
          },
          required: ["agreedPrice", "availableTime"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: "system",
        content:
          "Extract only explicit vendor quote details. Never infer a price or availability. A price range, estimate, or ambiguous statement is not an agreed price.",
      },
      { role: "user", content: message },
    ],
  });
  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error("OpenAI returned no quote extraction.");

  const extracted: unknown = JSON.parse(content);
  if (!isQuoteExtraction(extracted)) {
    throw new Error("OpenAI returned an invalid quote extraction.");
  }
  return extracted;
}

export async function POST(request: Request) {
  const rateLimitResponse = await enforceWebhookRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = request.headers.get("x-twilio-signature");
  const publicUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!authToken || !signature || !publicUrl) {
    return new NextResponse("Webhook configuration is incomplete.", { status: 500 });
  }

  const formData = await request.formData();
  const fields = Object.fromEntries(
    [...formData.entries()].filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const webhookUrl = `${publicUrl.replace(/\/$/, "")}/api/webhooks/twilio-sms`;
  if (!twilio.validateRequest(authToken, signature, webhookUrl, fields)) {
    return new NextResponse("Invalid Twilio signature.", { status: 403 });
  }

  const from = fields.From;
  const body = fields.Body;
  if (!from || !body) {
    return new NextResponse("Missing sender or message body.", { status: 400 });
  }

  const supabase = await createServiceClient();
  const { data: vendor, error: vendorError } = await supabase
    .from("vendors")
    .select("id")
    .eq("phone_number", from)
    .maybeSingle();
  if (vendorError) {
    return new NextResponse(`Unable to identify vendor: ${vendorError.message}`, {
      status: 500,
    });
  }

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id, organization_id")
    .eq("target_vendor_phone", from)
    .in("status", ["pending", "in_progress", "failed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (taskError) {
    return new NextResponse(`Unable to find vendor task: ${taskError.message}`, {
      status: 500,
    });
  }
  if (!vendor || !task) {
    return new NextResponse("No matching vendor fallback request.", { status: 404 });
  }

  let quote: QuoteExtraction;
  try {
    quote = await extractQuote(body);
  } catch (error) {
    captureException(error, { route: "twilio-sms-webhook", vendorPhone: from });
    const message =
      error instanceof Error ? error.message : "Unable to extract vendor quote.";
    return new NextResponse(message, { status: 502 });
  }

  if (quote.agreedPrice === null) {
    return new NextResponse(
      "Thanks. We could not identify a firm quoted price; the request remains open.",
      { status: 200 },
    );
  }

  const { data: callLog, error: callLogError } = await supabase
    .from("call_logs")
    .select("id")
    .eq("task_id", task.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (callLogError || !callLog) {
    return new NextResponse(
      callLogError
        ? `Unable to find task call log: ${callLogError.message}`
        : "No call log exists for this task.",
      { status: 500 },
    );
  }

  const { error: updateCallLogError } = await supabase
    .from("call_logs")
    .update({
      agreed_price: quote.agreedPrice,
      available_time: quote.availableTime,
      status: "completed",
    })
    .eq("id", callLog.id);
  if (updateCallLogError) {
    return new NextResponse(
      `Unable to save vendor quote: ${updateCallLogError.message}`,
      { status: 500 },
    );
  }

  const { error: updateTaskError } = await supabase
    .from("tasks")
    .update({ status: "completed" })
    .eq("id", task.id);
  if (updateTaskError) {
    return new NextResponse(
      `Unable to update task: ${updateTaskError.message}`,
      { status: 500 },
    );
  }
  if (task.organization_id) {
    void dispatchWebhookEvent(task.organization_id, "quote.accepted", {
      taskId: task.id,
      agreedPrice: quote.agreedPrice,
      availableTime: quote.availableTime,
    }).catch((error: unknown) => {
      captureException(error, {
        route: "twilio-sms-webhook",
        taskId: task.id,
        operation: "webhook-delivery",
      });
    });
  }

  return new NextResponse(
    "Thanks for the quote. We have sent it to the customer for confirmation.",
    { status: 200, headers: { "Content-Type": "text/plain" } },
  );
}
