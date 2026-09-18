import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServiceClient } = vi.hoisted(() => ({ createServiceClient: vi.fn() }));
vi.mock("@/server", () => ({ createServiceClient }));

import { authenticateApiKey } from "@/lib/api-key";

type Lookup = { data: unknown; error: { message: string } | null };

/** Chainable Supabase mock covering the exact calls authenticateApiKey makes. */
function makeSupabase(opts: { lookup: Lookup; updateError?: { message: string } | null }) {
  const eqCalls: Array<{ op: string; col: string; val: unknown }> = [];
  const client = {
    eqCalls,
    from() {
      return {
        select() {
          return {
            eq(col: string, val: unknown) {
              eqCalls.push({ op: "lookup", col, val });
              return { maybeSingle: async () => opts.lookup };
            },
          };
        },
        update(payload: unknown) {
          return {
            eq(col: string, val: unknown) {
              eqCalls.push({ op: "update", col, val });
              return Promise.resolve({ error: opts.updateError ?? null, payload });
            },
          };
        },
      };
    },
  };
  return client;
}

function requestWith(headers: Record<string, string>) {
  return new Request("https://example.com/api/v1/tasks", { headers });
}

beforeEach(() => {
  createServiceClient.mockReset();
});

describe("authenticateApiKey", () => {
  it("returns null when no Authorization header is present", async () => {
    const result = await authenticateApiKey(requestWith({}));
    expect(result).toBeNull();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("returns null for a token without the tp_live_ prefix", async () => {
    const result = await authenticateApiKey(requestWith({ authorization: "Bearer nope_123" }));
    expect(result).toBeNull();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("looks up the SHA-256 hash of the token (never the raw key)", async () => {
    const token = "tp_live_secretvalue";
    const supabase = makeSupabase({
      lookup: { data: { id: "k1", organization_id: "org1", created_by_user_id: "u1" }, error: null },
    });
    createServiceClient.mockResolvedValue(supabase);

    const result = await authenticateApiKey(requestWith({ authorization: `Bearer ${token}` }));

    const expectedHash = createHash("sha256").update(token).digest("hex");
    const lookup = supabase.eqCalls.find((c) => c.op === "lookup");
    expect(lookup).toEqual({ op: "lookup", col: "key_hash", val: expectedHash });
    expect(lookup?.val).not.toBe(token);
    expect(result?.apiKey).toEqual({ id: "k1", organization_id: "org1", created_by_user_id: "u1" });
    expect(result?.supabase).toBe(supabase);
  });

  it("returns null when the key hash matches no row", async () => {
    const supabase = makeSupabase({ lookup: { data: null, error: null } });
    createServiceClient.mockResolvedValue(supabase);
    const result = await authenticateApiKey(requestWith({ authorization: "Bearer tp_live_unknown" }));
    expect(result).toBeNull();
  });

  it("stamps last_used_at on the matched key", async () => {
    const supabase = makeSupabase({
      lookup: { data: { id: "k1", organization_id: "org1", created_by_user_id: "u1" }, error: null },
    });
    createServiceClient.mockResolvedValue(supabase);
    await authenticateApiKey(requestWith({ authorization: "Bearer tp_live_secretvalue" }));
    expect(supabase.eqCalls).toContainEqual({ op: "update", col: "id", val: "k1" });
  });

  it("throws when the lookup query errors", async () => {
    const supabase = makeSupabase({ lookup: { data: null, error: { message: "db down" } } });
    createServiceClient.mockResolvedValue(supabase);
    await expect(
      authenticateApiKey(requestWith({ authorization: "Bearer tp_live_secretvalue" })),
    ).rejects.toThrow(/db down/);
  });
});
