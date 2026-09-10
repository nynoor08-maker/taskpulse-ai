import OpenAI from "openai";
import { createServiceClient } from "@/server";

export type ConversationAnalysis = {
  vendorSentiment: "positive" | "neutral" | "aggressive" | "resistant";
  negotiationFrictionPoints: string[];
  agentPolitenessScore: number;
  dealClosed: boolean;
};

function isAnalysis(value: unknown): value is ConversationAnalysis {
  if (!value || typeof value !== "object") return false;
  const analysis = value as Record<string, unknown>;
  return ["positive", "neutral", "aggressive", "resistant"].includes(String(analysis.vendorSentiment)) &&
    Array.isArray(analysis.negotiationFrictionPoints) &&
    analysis.negotiationFrictionPoints.every((point) => typeof point === "string") &&
    typeof analysis.agentPolitenessScore === "number" &&
    Number.isInteger(analysis.agentPolitenessScore) &&
    analysis.agentPolitenessScore >= 1 &&
    analysis.agentPolitenessScore <= 10 &&
    typeof analysis.dealClosed === "boolean";
}

export async function analyzeCallLog(callLogId: string): Promise<ConversationAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI configuration is incomplete.");
  const supabase = await createServiceClient();
  const { data: callLog, error } = await supabase
    .from("call_logs")
    .select("transcript, agreed_price")
    .eq("id", callLogId)
    .single();
  if (error) throw new Error(`Unable to load call transcript: ${error.message}`);
  if (!callLog.transcript) throw new Error("Call has no transcript to analyze.");

  const completion = await new OpenAI({ apiKey }).chat.completions.create({
    model: "gpt-4o-mini",
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "conversation_analysis",
        strict: true,
        schema: {
          type: "object",
          properties: {
            vendorSentiment: { type: "string", enum: ["positive", "neutral", "aggressive", "resistant"] },
            negotiationFrictionPoints: { type: "array", items: { type: "string" } },
            agentPolitenessScore: { type: "integer", minimum: 1, maximum: 10 },
            dealClosed: { type: "boolean" },
          },
          required: ["vendorSentiment", "negotiationFrictionPoints", "agentPolitenessScore", "dealClosed"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: "system",
        content: "Analyze only the supplied transcript. Do not infer facts. A deal is closed only when an explicit price agreement is reached.",
      },
      { role: "user", content: `Recorded agreed price: ${callLog.agreed_price ?? "none"}\n\nTranscript:\n${callLog.transcript}` },
    ],
  });
  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error("OpenAI returned no conversation analysis.");
  const analysis: unknown = JSON.parse(content);
  if (!isAnalysis(analysis)) throw new Error("OpenAI returned an invalid conversation analysis.");

  const { error: saveError } = await supabase.from("call_analytics").upsert({
    call_log_id: callLogId,
    vendor_sentiment: analysis.vendorSentiment,
    negotiation_friction_points: analysis.negotiationFrictionPoints,
    agent_politeness_score: analysis.agentPolitenessScore,
    deal_closed: analysis.dealClosed,
  }, { onConflict: "call_log_id" });
  if (saveError) throw new Error(`Unable to save conversation analysis: ${saveError.message}`);
  return analysis;
}
