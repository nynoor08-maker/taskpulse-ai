import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key";
import { captureException, enforceRateLimit } from "@/lib/security";

export async function GET(request: Request) {
  const rateLimitResponse = await enforceRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const authentication = await authenticateApiKey(request);
    if (!authentication) {
      return NextResponse.json({ error: "A valid bearer API key is required." }, { status: 401 });
    }

    const updatedSince = new URL(request.url).searchParams.get("updated_since");
    const query = authentication.supabase
      .from("tasks")
      .select("id, title, description, target_vendor_phone, max_budget, status, payment_status, callback_url, created_at")
      .eq("organization_id", authentication.apiKey.organization_id)
      .order("created_at", { ascending: false })
      .limit(100);
    const { data, error } = updatedSince
      ? await query.gte("created_at", updatedSince)
      : await query;
    if (error) throw new Error(`Unable to load tasks: ${error.message}`);

    return NextResponse.json({ tasks: data ?? [] });
  } catch (error) {
    captureException(error, { route: "zapier-tasks" });
    return NextResponse.json({ error: "Unable to load tasks." }, { status: 500 });
  }
}
