import { redirect } from "next/navigation";
import { AdminMonitor } from "./admin-monitor";
import { requireAdmin } from "@/lib/admin";
import { asOne } from "@/lib/relations";

export const dynamic = "force-dynamic";

function numericValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default async function AdminPage() {
  let authorization;
  try {
    authorization = await requireAdmin();
  } catch {
    throw new Error("Unable to load administrator dashboard.");
  }

  if ("error" in authorization) {
    redirect("/");
  }

  const { supabase } = authorization;
  const [
    tasksResult,
    callsResult,
    completedCallsResult,
    paidTasksResult,
    settingsResult,
    activeCallsResult,
  ] = await Promise.all([
    supabase.from("tasks").select("id", { count: "exact", head: true }),
    supabase
      .from("call_logs")
      .select("agreed_price, tasks(max_budget)")
      .eq("status", "completed"),
    supabase.from("call_logs").select("id", { count: "exact", head: true }),
    supabase
      .from("tasks")
      .select("call_logs(agreed_price)")
      .eq("payment_status", "paid"),
    supabase
      .from("app_settings")
      .select("dispatch_paused")
      .eq("key", "dispatch")
      .single(),
    supabase
      .from("call_logs")
      .select("id, vapi_call_id, call_duration, status, created_at, tasks(target_vendor_phone)")
      .in("status", ["in_progress", "completed", "failed"])
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const results = [
    tasksResult,
    callsResult,
    completedCallsResult,
    paidTasksResult,
    settingsResult,
    activeCallsResult,
  ];
  const failedResult = results.find((result) => result.error);
  if (failedResult?.error) {
    throw new Error(`Unable to load administrator dashboard: ${failedResult.error.message}`);
  }
  if (!settingsResult.data) {
    throw new Error("Unable to load dispatch settings.");
  }

  const completedCalls = callsResult.data ?? [];
  const averageSavings =
    completedCalls.length === 0
      ? 0
      : completedCalls.reduce((total, call) => {
          const task = asOne(call.tasks);
          return total + (numericValue(task?.max_budget) - numericValue(call.agreed_price));
        }, 0) / completedCalls.length;

  const platformVolume = (paidTasksResult.data ?? []).reduce((total, task) => {
    const callLogs = Array.isArray(task.call_logs) ? task.call_logs : task.call_logs ? [task.call_logs] : [];
    return total + Math.max(...callLogs.map((call) => numericValue(call.agreed_price)), 0);
  }, 0);

  return (
    <AdminMonitor
      initialCalls={(activeCallsResult.data ?? []).map((call) => ({
        ...call,
        tasks: asOne(call.tasks) ? [asOne(call.tasks)!] : [],
      }))}
      dispatchPaused={settingsResult.data.dispatch_paused}
      metrics={{
        totalTasks: tasksResult.count ?? 0,
        completionRate:
          (completedCallsResult.count ?? 0) === 0
            ? 0
            : (completedCalls.length / (completedCallsResult.count ?? 1)) * 100,
        averageSavings,
        platformVolume,
      }}
    />
  );
}
