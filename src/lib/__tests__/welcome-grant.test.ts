import { describe, it, expect, vi, beforeEach } from "vitest";

// grantWelcomeDiscount tombstone gate (migration 004): a phone present in
// welcome_discount_history must never receive a fresh welcome_discounts
// row, closing the delete-account + re-signup grind. History lookup
// errors fail OPEN (grant proceeds).

const maybeSingle = vi.fn();
const upsert = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "welcome_discount_history") {
        return { select: () => ({ eq: () => ({ maybeSingle }) }) };
      }
      if (table === "welcome_discounts") {
        return { upsert };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { grantWelcomeDiscount } from "@/lib/supabase";

beforeEach(() => {
  maybeSingle.mockReset();
  upsert.mockReset();
  upsert.mockResolvedValue({ error: null });
});

describe("grantWelcomeDiscount tombstone gate", () => {
  it("grants when the phone has no consumption history", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await grantWelcomeDiscount("CUST_NEW", "+61400000001");
    expect(upsert).toHaveBeenCalledWith(
      { customer_id: "CUST_NEW" },
      { onConflict: "customer_id", ignoreDuplicates: true },
    );
  });

  it("skips the grant when the phone already consumed a welcome", async () => {
    maybeSingle.mockResolvedValue({
      data: { phone_e164: "+61400000002" },
      error: null,
    });
    await grantWelcomeDiscount("CUST_RECREATED", "+61400000002");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("fails open when the history lookup errors", async () => {
    maybeSingle.mockResolvedValue({
      data: null,
      error: { message: "connection refused" },
    });
    await grantWelcomeDiscount("CUST_BLIP", "+61400000003");
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("never throws when the upsert itself fails", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    upsert.mockResolvedValue({ error: { message: "duplicate" } });
    await expect(
      grantWelcomeDiscount("CUST_ERR", "+61400000004"),
    ).resolves.toBeUndefined();
  });
});
