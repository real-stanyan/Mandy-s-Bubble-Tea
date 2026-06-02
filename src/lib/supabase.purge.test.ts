import { describe, it, expect, vi, beforeEach } from "vitest";

// Records the order in which `.from(table).delete()` is invoked so we can
// assert FK-child tables are released before their parent (user_profiles).
const deleteOrder: string[] = [];
let deleteErrors: Record<string, { message: string } | null> = {};

const adminMock = {
  from: (table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data:
            table === "user_profiles"
              ? { square_customer_id: "CUST1", user_id: "U1" }
              : null,
        }),
      }),
    }),
    delete: () => ({
      eq: async () => {
        deleteOrder.push(table);
        return { error: deleteErrors[table] ?? null };
      },
    }),
  }),
  auth: {
    admin: {
      updateUserById: vi.fn(async () => ({ error: null })),
      deleteUser: vi.fn(async () => ({ error: null })),
    },
  },
};

vi.mock("./supabase-server", () => ({
  getSupabaseAdmin: () => adminMock,
}));

import { purgeAccount } from "./supabase";

beforeEach(() => {
  deleteOrder.length = 0;
  deleteErrors = {};
});

describe("purgeAccount FK-child cleanup", () => {
  it("deletes mandy_customer_metrics before user_profiles", async () => {
    await purgeAccount({ userId: "U1" });

    expect(deleteOrder).toContain("mandy_customer_metrics");
    expect(deleteOrder).toContain("user_profiles");
    // The whole bug: the metrics row references user_profiles via
    // mandy_customer_metrics_user_id_fkey (ON DELETE NO ACTION), so it must
    // be deleted FIRST or the user_profiles delete hits a FK violation.
    expect(deleteOrder.indexOf("mandy_customer_metrics")).toBeLessThan(
      deleteOrder.indexOf("user_profiles"),
    );
  });

  it("surfaces a user_profiles delete failure as a thrown error", async () => {
    deleteErrors["user_profiles"] = {
      message:
        'update or delete on table "user_profiles" violates foreign key constraint "mandy_customer_metrics_user_id_fkey" on table "mandy_customer_metrics"',
    };
    await expect(purgeAccount({ userId: "U1" })).rejects.toThrow(
      /Failed to release user_profiles row/,
    );
  });
});
