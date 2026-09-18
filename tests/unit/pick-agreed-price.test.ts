import { describe, expect, it } from "vitest";
import { pickAgreedPrice } from "@/lib/pick-agreed-price";

describe("pickAgreedPrice", () => {
  it("returns null for empty, null, or undefined input", () => {
    expect(pickAgreedPrice([])).toBeNull();
    expect(pickAgreedPrice(null)).toBeNull();
    expect(pickAgreedPrice(undefined)).toBeNull();
  });

  it("returns the only positive agreed price", () => {
    expect(pickAgreedPrice([{ agreed_price: 150 }])).toBe(150);
  });

  it("ignores null, zero, and negative prices", () => {
    expect(
      pickAgreedPrice([
        { agreed_price: null },
        { agreed_price: 0 },
        { agreed_price: -20 },
        { agreed_price: 99 },
      ]),
    ).toBe(99);
  });

  it("picks the newest positive price by created_at, not array order", () => {
    const price = pickAgreedPrice([
      { agreed_price: 100, created_at: "2026-01-01T00:00:00Z" },
      { agreed_price: 250, created_at: "2026-03-01T00:00:00Z" },
      { agreed_price: 175, created_at: "2026-02-01T00:00:00Z" },
    ]);
    expect(price).toBe(250);
  });

  it("skips a newer non-positive price and falls back to the newest positive one", () => {
    const price = pickAgreedPrice([
      { agreed_price: null, created_at: "2026-05-01T00:00:00Z" },
      { agreed_price: 0, created_at: "2026-04-01T00:00:00Z" },
      { agreed_price: 120, created_at: "2026-03-01T00:00:00Z" },
    ]);
    expect(price).toBe(120);
  });
});
