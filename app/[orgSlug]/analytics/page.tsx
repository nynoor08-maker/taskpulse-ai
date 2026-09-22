import { notFound, redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/server";
import { asOne } from "@/lib/relations";
import { ConversationCharts } from "./conversation-charts";

export default async function AnalyticsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) redirect("/");
  const { data: membership } = await userClient.from("organization_members").select("organizations!inner(id, slug)").eq("user_id", user.id).eq("organizations.slug", orgSlug).maybeSingle();
  if (!membership) notFound();
  const organization = asOne(membership.organizations);
  if (!organization) notFound();
  const organizationId = organization.id;
  const supabase = await createServiceClient();
  const [{ data: calls, error: callsError }, { data: promptVariants, error: variantsError }] = await Promise.all([
    supabase.from("call_logs").select("agreed_price, prompt_variant_id, tasks(max_budget), call_analytics(vendor_sentiment, negotiation_friction_points, deal_closed)").eq("organization_id", organizationId).eq("status", "completed"),
    supabase.from("prompt_variants").select("id, name").eq("organization_id", organizationId),
  ]);
  if (callsError || variantsError) throw new Error(callsError?.message ?? variantsError?.message);
  const sentimentCounts = new Map<string, number>();
  const objections = new Map<string, number>();
  const performance = new Map((promptVariants ?? []).map((variant) => [variant.id, { name: variant.name, calls: 0, closed: 0, savings: 0 }]));
  for (const call of calls ?? []) {
    const analytics = asOne(call.call_analytics);
    if (analytics) {
      sentimentCounts.set(analytics.vendor_sentiment, (sentimentCounts.get(analytics.vendor_sentiment) ?? 0) + 1);
      for (const point of analytics.negotiation_friction_points) objections.set(point, (objections.get(point) ?? 0) + 1);
    }
    if (call.prompt_variant_id && performance.has(call.prompt_variant_id)) {
      const item = performance.get(call.prompt_variant_id)!;
      item.calls++;
      if (analytics?.deal_closed) item.closed++;
      const task = asOne(call.tasks);
      if (task?.max_budget != null && call.agreed_price != null) item.savings += Math.max(0, task.max_budget - call.agreed_price);
    }
  }
  return <main className="mx-auto max-w-7xl px-6 py-10">
    <h1 className="text-2xl font-semibold">Conversation intelligence</h1><p className="mt-2 text-sm text-slate-600">Completed calls with AI analysis are reflected here.</p>
    <div className="mt-8"><ConversationCharts sentiment={[...sentimentCounts].map(([name, calls]) => ({ name, calls }))} objections={[...objections].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count }))} variants={[...performance.values()].map((item) => ({ name: item.name, conversionRate: item.calls ? Math.round(item.closed / item.calls * 100) : 0, averageSavings: item.calls ? Math.round(item.savings / item.calls * 100) / 100 : 0 }))} /></div>
  </main>;
}
