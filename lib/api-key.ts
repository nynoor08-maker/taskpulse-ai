import { createHash } from "node:crypto";
import { createServiceClient } from "@/server";

export async function authenticateApiKey(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token?.startsWith("tp_live_")) return null;

  const keyHash = createHash("sha256").update(token).digest("hex");
  const supabase = await createServiceClient();
  const { data: apiKey, error } = await supabase
    .from("api_keys")
    .select("id, organization_id, created_by_user_id")
    .eq("key_hash", keyHash)
    .maybeSingle();
  if (error) throw new Error(`Unable to validate API key: ${error.message}`);
  if (!apiKey) return null;

  const { error: updateError } = await supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", apiKey.id);
  if (updateError) throw new Error(`Unable to update API key: ${updateError.message}`);

  return { supabase, apiKey };
}
