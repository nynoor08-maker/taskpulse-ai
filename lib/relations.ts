/** Normalize Supabase nested many-to-one relations that may arrive as object or array. */
export function asOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
