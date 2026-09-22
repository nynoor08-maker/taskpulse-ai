import type { SupabaseClient } from "@supabase/supabase-js";

export const DAILY_DISPATCH_LIMIT = 5;
export const DAILY_DISPATCH_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DAILY_DISPATCH_LIMIT_MESSAGE =
  "Daily dispatch limit reached. You can dispatch up to 5 calls every 24 hours.";

export type DailyDispatchLimitResult =
  | { ok: true; count: number }
  | { ok: false; status: 429 | 500; error: string };

/**
 * Enforce the launch abuse cap: at most 5 outbound call_logs tied to the
 * user's tasks created in the last 24 hours.
 */
export async function checkDailyDispatchLimit(
  supabase: SupabaseClient,
  userId: string,
): Promise<DailyDispatchLimitResult> {
  const windowStart = new Date(Date.now() - DAILY_DISPATCH_WINDOW_MS).toISOString();
  const { data: recentTasks, error: recentTasksError } = await supabase
    .from("tasks")
    .select("id")
    .eq("user_id", userId)
    .gte("created_at", windowStart);

  if (recentTasksError) {
    return {
      ok: false,
      status: 500,
      error: `Unable to check dispatch limit: ${recentTasksError.message}`,
    };
  }

  const taskIds = (recentTasks ?? []).map((task) => task.id as string);
  if (taskIds.length === 0) {
    return { ok: true, count: 0 };
  }

  const { count, error: rateLimitError } = await supabase
    .from("call_logs")
    .select("id", { count: "exact", head: true })
    .in("task_id", taskIds);

  if (rateLimitError) {
    return {
      ok: false,
      status: 500,
      error: `Unable to check dispatch limit: ${rateLimitError.message}`,
    };
  }

  const dispatchCount = count ?? 0;
  if (dispatchCount >= DAILY_DISPATCH_LIMIT) {
    return { ok: false, status: 429, error: DAILY_DISPATCH_LIMIT_MESSAGE };
  }

  return { ok: true, count: dispatchCount };
}
