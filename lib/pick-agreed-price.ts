/** Picks the newest positive agreed_price from nested call_logs (dashboard/pay UI). */
export function pickAgreedPrice(
  callLogs: Array<{ agreed_price: number | null; created_at?: string }> | null | undefined,
) {
  const logs = Array.isArray(callLogs) ? callLogs : [];
  return (
    [...logs]
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
      .find((log) => typeof log.agreed_price === "number" && log.agreed_price > 0)?.agreed_price ??
    null
  );
}
