import type { createServiceClient } from "@/server";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

export type PoolVendor = {
  id: string;
  phone_number: string;
  organization_id: string | null;
  hourly_rate: number;
};

export type VendorPoolOptions = {
  category: string;
  /** Restrict the search to a specific organization's vendor pool, when known. */
  organizationId?: string | null;
  /** Prefer a vendor whose declared service area includes this ZIP code. */
  zipCode?: string | null;
  /** Phone numbers to skip, e.g. vendors already dialed for this task. */
  excludePhones?: string[];
};

/**
 * Finds the best available vendor for a category: cheapest first, preferring
 * one whose service area covers the given ZIP code, skipping any phone
 * numbers already attempted for this task.
 */
export async function findNextVendor(
  supabase: ServiceClient,
  options: VendorPoolOptions,
): Promise<PoolVendor | null> {
  let query = supabase
    .from("vendors")
    .select("id, phone_number, organization_id, service_zip_codes, hourly_rate")
    .eq("category", options.category)
    .eq("is_accepting_jobs", true)
    .order("hourly_rate", { ascending: true });

  if (options.organizationId) {
    query = query.eq("organization_id", options.organizationId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Unable to search for vendors: ${error.message}`);

  const exclude = new Set(options.excludePhones ?? []);
  const candidates = (data ?? []).filter((vendor) => !exclude.has(vendor.phone_number));

  if (options.zipCode) {
    const inServiceArea = candidates.find(
      (vendor) => !vendor.service_zip_codes?.length || vendor.service_zip_codes.includes(options.zipCode!),
    );
    if (inServiceArea) return inServiceArea;
  }

  return candidates[0] ?? null;
}
