export type ApplyVendorQuoteInput = {
  taskId: string;
  vendorPhone: string;
  organizationId: string | null;
  quotedPrice: number;
  availableTime: string;
  notes?: string;
};

/** Minimal Supabase-like client used by API routes and smoke scripts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QuoteDb = { from: (table: string) => any };

/**
 * Records a vendor fallback quote onto the latest matching call_log (or inserts
 * one), then marks the task completed so the customer can pay.
 */
export async function applyVendorQuote(supabase: QuoteDb, input: ApplyVendorQuoteInput) {
  const summaryNotes = input.notes?.trim()
    ? `Vendor quote notes: ${input.notes.trim()}`
    : "Quote submitted by vendor via fallback form.";

  const { data: existingLogs, error: existingError } = await supabase
    .from("call_logs")
    .select("id")
    .eq("task_id", input.taskId)
    .eq("vendor_phone", input.vendorPhone)
    .order("created_at", { ascending: false })
    .limit(1);
  if (existingError) throw new Error(existingError.message);

  const existingLogId = (existingLogs as Array<{ id: string }> | null)?.[0]?.id;
  let callLogId: string;

  if (existingLogId) {
    const { data: updated, error: updateError } = await supabase
      .from("call_logs")
      .update({
        agreed_price: input.quotedPrice,
        available_time: input.availableTime.trim(),
        summary: summaryNotes,
        status: "completed",
        fallback_dispatched: true,
      })
      .eq("id", existingLogId)
      .select("id")
      .single();
    if (updateError) throw new Error(updateError.message);
    callLogId = (updated as { id: string }).id;
  } else {
    const { data: inserted, error: callError } = await supabase
      .from("call_logs")
      .insert({
        organization_id: input.organizationId,
        task_id: input.taskId,
        vendor_phone: input.vendorPhone,
        agreed_price: input.quotedPrice,
        available_time: input.availableTime.trim(),
        summary: summaryNotes,
        status: "completed",
        fallback_dispatched: true,
      })
      .select("id")
      .single();
    if (callError) throw new Error(callError.message);
    callLogId = (inserted as { id: string }).id;
  }

  const { error: taskUpdateError } = await supabase
    .from("tasks")
    .update({ status: "completed" })
    .eq("id", input.taskId);
  if (taskUpdateError) throw new Error(taskUpdateError.message);

  return { callLogId };
}
