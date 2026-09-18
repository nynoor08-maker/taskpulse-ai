import { describe, expect, it } from "vitest";
import { findNextVendor } from "@/lib/vendor-pool";

type VendorRow = {
  id: string;
  phone_number: string;
  organization_id: string | null;
  service_zip_codes: string[] | null;
  hourly_rate: number;
};

/**
 * Minimal chainable Supabase mock for the query `findNextVendor` builds:
 * from().select().eq().eq().order()[.eq()] then awaited. Every method returns
 * the same builder, which is thenable and resolves to { data, error }.
 */
function vendorsClient(data: VendorRow[] | null, error: { message: string } | null = null) {
  const eqCalls: Array<[string, unknown]> = [];
  const builder = {
    from: () => builder,
    select: () => builder,
    eq: (col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return builder;
    },
    order: () => builder,
    then: (resolve: (value: { data: VendorRow[] | null; error: unknown }) => void) =>
      resolve({ data, error }),
    eqCalls,
  };
  return builder;
}

const cheap: VendorRow = {
  id: "a",
  phone_number: "+15550000001",
  organization_id: "org1",
  service_zip_codes: ["99999"],
  hourly_rate: 50,
};
const pricier: VendorRow = {
  id: "b",
  phone_number: "+15550000002",
  organization_id: "org1",
  service_zip_codes: ["12345"],
  hourly_rate: 80,
};

describe("findNextVendor", () => {
  it("returns the first (cheapest) candidate when no ZIP is given", async () => {
    const client = vendorsClient([cheap, pricier]);
    const vendor = await findNextVendor(client as never, { category: "plumbing" });
    expect(vendor?.id).toBe("a");
  });

  it("prefers a vendor whose service area covers the ZIP over a cheaper out-of-area vendor", async () => {
    const client = vendorsClient([cheap, pricier]);
    const vendor = await findNextVendor(client as never, {
      category: "plumbing",
      zipCode: "12345",
    });
    expect(vendor?.id).toBe("b");
  });

  it("treats an empty service-area list as covering every ZIP", async () => {
    const unrestricted: VendorRow = { ...cheap, id: "c", service_zip_codes: [] };
    const client = vendorsClient([unrestricted, pricier]);
    const vendor = await findNextVendor(client as never, {
      category: "plumbing",
      zipCode: "12345",
    });
    expect(vendor?.id).toBe("c");
  });

  it("skips phone numbers already attempted for the task", async () => {
    const client = vendorsClient([cheap, pricier]);
    const vendor = await findNextVendor(client as never, {
      category: "plumbing",
      excludePhones: [cheap.phone_number],
    });
    expect(vendor?.id).toBe("b");
  });

  it("returns null when every candidate is excluded", async () => {
    const client = vendorsClient([cheap, pricier]);
    const vendor = await findNextVendor(client as never, {
      category: "plumbing",
      excludePhones: [cheap.phone_number, pricier.phone_number],
    });
    expect(vendor).toBeNull();
  });

  it("scopes the query to an organization when organizationId is provided", async () => {
    const client = vendorsClient([cheap]);
    await findNextVendor(client as never, { category: "plumbing", organizationId: "org1" });
    expect(client.eqCalls).toContainEqual(["organization_id", "org1"]);
  });

  it("throws when the query returns an error", async () => {
    const client = vendorsClient(null, { message: "db down" });
    await expect(
      findNextVendor(client as never, { category: "plumbing" }),
    ).rejects.toThrow(/db down/);
  });
});
